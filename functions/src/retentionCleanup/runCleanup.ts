/**
 * The retentionCleanup ORCHESTRATOR — the scan/page/filter/delete/report loop,
 * lifted out of index.ts so a test can drive it (BIN-727).
 *
 * Why it lives here and not in index.ts: index.ts imports firebase-admin +
 * firebase-functions, and NEITHER is installed in the root toolchain (`npm ci` at
 * the repo root is all CI's `rules-tests` job installs — see .github/workflows/
 * deploy.yml). So any file the emulator harness must import has to be admin-free,
 * exactly like ./logic.ts and ./orphans.ts. This module therefore takes its
 * Firestore AND its Auth access as one injected PORT (`CleanupIo`) and imports
 * nothing but those two pure siblings — index.ts implements the port with the
 * Admin SDK, `src/test/rules/retention-cleanup-orchestrator.test.ts` implements
 * it with the client SDK against a real Firestore emulator plus an in-memory
 * Auth double. Same shape as tmdbTosSweep/runSweep.ts (BIN-566), which is the
 * pattern #27's rescope told this ticket to copy.
 *
 * Everything Firestore- or Auth-SHAPED (collection-group queries, `.select()`
 * projections, `recursiveDelete`, `getAll`, `getUsers`, `listUsers`,
 * `deleteUsers`, one batch commit) stays in the port. Everything the sweep
 * DECIDES lives here, under test:
 *   - paging and cursor advance for the Firestore scans (`ScanKind`; the one
 *     exception is `listUserUids`, which the Admin API gives no cursor to page)
 *   - which docs each TTL predicate reaps (and that a doc ON the threshold is kept)
 *   - the uid derivation for `users/{uid}/fcmTokens/*`
 *   - "could not verify" is never "gone": a failed lookup batch skips only itself
 *   - the orphan ceiling actually filtering what gets deleted
 *   - per-category error isolation, and the −1-vs-0 reporting that makes a dead
 *     scan readable as "we do not know" rather than "we found nothing"
 *
 * An Auth double rather than the Auth emulator is deliberate (#27, condition 1):
 * the three newest sweeps (BIN-848/816/875) are the ones whose false positive
 * destroys a live account, and driving them needs precise control over what
 * `getUsers` answers — including a batch that throws, which no emulator offers.
 */

import {
  isExpiredSession,
  isStaleNotification,
  isStaleJoinAttempt,
  isStaleReleaseMarker,
  tsToMillis,
  revokedUidsInBatches,
  chunkUids,
  type UserLookupResult,
} from './logic';
import {
  absentUidsFromLookup,
  isOrphanCandidate,
  orphanedReservations,
  partitionOrphanData,
  withinOrphanCeiling,
} from './orphans';

/** One scanned document, flattened to the two things the loop judges on. */
export interface ScanDoc {
  /** Full Firestore path, e.g. `users/{uid}/fcmTokens/{tokenId}`. */
  readonly path: string;
  /** The `.select()`-narrowed field map (empty for scans that read no field). */
  readonly data: Record<string, unknown>;
}

/** The Firestore scans, named so a port cannot silently answer the wrong one. */
export type ScanKind =
  | 'sessions'
  | 'notifications'
  | 'joinAttempts'
  | 'releaseMarkers'
  | 'fcmTokens'
  | 'usernames'
  // BIN-1023: `orphanWatch/{uid}` holds `firstSeenAt` — the run-to-run memory
  // that turns "absent right now" into "absent on two separate days".
  | 'orphanWatch';

/** One Firebase Auth account, narrowed to the fields the orphan sweep reads. */
export interface AuthAccount {
  readonly uid: string;
  readonly disabled?: boolean;
  readonly metadata?: { creationTime?: unknown };
}

/** One page of `listUsers`. */
export interface AuthPage {
  readonly users: readonly AuthAccount[];
  /** Absent/empty on the last page. */
  readonly pageToken?: string;
}

/** What `deleteUsers` reports — per-uid failures WITHOUT rejecting. */
export interface AuthDeleteResult {
  readonly successCount: number;
  readonly failureCount: number;
  readonly errors: readonly { readonly message: string }[];
}

/** The subset of firebase-functions' logger this loop uses. */
export interface CleanupLogger {
  info(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/**
 * The injected port. Deliberately primitive: every method maps 1:1 to ONE
 * Firestore or Auth operation the real sweep performs, so a port implementation
 * has nowhere to hide a decision.
 */
export interface CleanupIo {
  /** Docs per scan page. Prod passes the real PAGE_SIZE; tests page smaller. */
  readonly pageSize: number;
  /** Docs per delete commit (prod: 450, under Firestore's 500 ceiling). */
  readonly deleteBatchSize: number;
  /** Uids per `getAll` of `users/{uid}` (prod: 300). */
  readonly profileBatchSize: number;
  readonly log: CleanupLogger;
  /** Wall clock, injected so every TTL boundary is drivable. */
  now(): number;

  /** One ordered page of `kind`, starting after the doc at `cursor` (a path). */
  scanPage(kind: ScanKind, cursor: string | null, pageSize: number): Promise<readonly ScanDoc[]>;
  /** Delete these leaf docs in ONE commit. Never called with more than deleteBatchSize. */
  deleteDocs(paths: readonly string[]): Promise<void>;
  /** Delete one session AND its subcollections (participants/*, swipes/*). */
  deleteSessionTree(path: string): Promise<void>;
  /**
   * Does `users/{uid}` exist, for each uid, IN THE SAME ORDER? One `getAll`.
   * Never called with more than profileBatchSize uids.
   */
  profilesExist(uids: readonly string[]): Promise<readonly boolean[]>;
  /** One `getUsers` lookup, by uid only. */
  lookupUsers(uids: readonly string[]): Promise<UserLookupResult>;
  /** One `listUsers` page. */
  listAuthAccounts(pageToken: string | undefined): Promise<AuthPage>;
  /** One `deleteUsers` batch. Never called with more than 1000 uids. */
  deleteAuthUsers(uids: readonly string[]): Promise<AuthDeleteResult>;

  /**
   * BIN-1023 — every uid that OWNS data under `users/*`, in one call.
   *
   * Deliberately not a `scanPage('users', …)`: a query returns only documents
   * that EXIST, and the state this sweep hunts includes a `users/{uid}` doc that
   * was deleted while its subcollections survived. The Admin SDK's
   * `listDocuments()` returns those ghost refs too, so the port answers with
   * uids rather than doc paths and the loop never has to know the difference.
   *
   * UNPAGED, unlike every other scan here, because `listDocuments()` offers no
   * cursor to page WITH. Inventing one on top of it would mean re-listing the
   * whole collection per page — strictly more work than reading it once — so the
   * honest contract is the one the API actually has. The bound is one short
   * string per account, and the sibling orphan-auth sweep already holds a
   * candidate list of the same order.
   */
  listUserUids(): Promise<readonly string[]>;
  /** Delete `users/{uid}` AND every subcollection under it. */
  deleteUserTree(uid: string): Promise<void>;
  /** Record `firstSeenAt = nowMs` for each uid, in ONE commit. Never more than deleteBatchSize. */
  stampOrphanWatch(uids: readonly string[], nowMs: number): Promise<void>;
}

/** Uids per `deleteUsers` call — the Admin API's own ceiling. */
export const AUTH_DELETE_BATCH = 1000;

/**
 * Everything the run reports. Returned as well as logged so a test can read the
 * numbers the summary line is built from — including the −1 sentinels, which are
 * the difference between "we checked and found nothing" and "we never checked".
 */
export interface CleanupSummary {
  expiredSessions: number;
  deletedSessions: number;
  staleNotifications: number;
  deletedNotifications: number;
  staleJoinAttempts: number;
  deletedJoinAttempts: number;
  staleReleaseMarkers: number;
  deletedReleaseMarkers: number;
  revokedPushTokens: number;
  deletedRevokedTokens: number;
  skippedAuthBatches: number;
  checkedUids: number;
  orphanAuthAccounts: number;
  deletedOrphanAuthAccounts: number;
  checkedAuthAccounts: number;
  orphanAuthSkippedProfileBatches: number;
  orphanUsernames: number;
  deletedOrphanUsernames: number;
  checkedReservations: number;
  orphanUsernameSkippedProfileBatches: number;
  orphanUsernameSkippedAuthBatches: number;
  orphanDataUids: number;
  erasedOrphanDataUids: number;
  checkedUserRoots: number;
  watchedOrphanDataUids: number;
  clearedOrphanDataWatches: number;
  orphanDataSkippedAuthBatches: number;
}

/**
 * Page a scan to exhaustion, handing each page to `onPage`.
 *
 * Bounded on purpose (mirrors reclaimOrphanFollows, BIN-50): peak memory stays
 * page-size + whatever the caller keeps. The cursor is the previous page's LAST
 * path — the port turns it back into a `startAfter`.
 */
async function pageThrough(
  io: CleanupIo,
  kind: ScanKind,
  onPage: (docs: readonly ScanDoc[]) => void,
): Promise<void> {
  let cursor: string | null = null;
  for (;;) {
    const docs = await io.scanPage(kind, cursor, io.pageSize);
    if (docs.length === 0) break;
    onPage(docs);
    if (docs.length < io.pageSize) break;
    cursor = docs[docs.length - 1].path;
  }
}

/** Sessions past their TTL, filtered per page. */
async function collectExpiredSessions(io: CleanupIo, nowMs: number): Promise<string[]> {
  const paths: string[] = [];
  await pageThrough(io, 'sessions', (docs) => {
    for (const d of docs) {
      // Both fields are load-bearing: they feed tsToMillis → isExpiredSession.
      // Lose either (a dropped `.select()` entry, a typo) and every session reads
      // as undateable → nothing is ever reaped, silently.
      if (isExpiredSession(tsToMillis(d.data.expiresAt), tsToMillis(d.data.createdAt), nowMs)) {
        paths.push(d.path);
      }
    }
  });
  return paths;
}

/**
 * The three age-only scans (notifications, joinAttempts, release markers).
 *
 * Shared because the shape is genuinely identical, but the KIND and the FIELD
 * are always passed as literals at the call site: #27's condition 3 warns that a
 * merged helper can turn a typo into a wholly missing sweep. Each category has
 * its own emulator test that reaps a real document, so a wrong field name here
 * fails a test rather than logging a quiet zero.
 */
async function collectStaleByField(
  io: CleanupIo,
  kind: ScanKind,
  field: string,
  isStale: (ageMs: number | null, nowMs: number) => boolean,
  nowMs: number,
): Promise<string[]> {
  const paths: string[] = [];
  await pageThrough(io, kind, (docs) => {
    for (const d of docs) {
      if (isStale(tsToMillis(d.data[field]), nowMs)) paths.push(d.path);
    }
  });
  return paths;
}

/**
 * The owner uid of a `users/{uid}/fcmTokens/{tokenId}` doc, or null.
 *
 * Derived from the path rather than a stored field (the scan reads no field at
 * all, and never a token value). Strict about the shape: anything else is a
 * collection-group match this sweep did not expect, and guessing a uid here would
 * put a stranger's uid to Auth and delete whatever it names.
 */
export function tokenOwnerUid(path: string): string | null {
  const parts = path.split('/');
  if (parts.length !== 4) return null;
  if (parts[0] !== 'users' || parts[2] !== 'fcmTokens') return null;
  return parts[1].length > 0 ? parts[1] : null;
}

/**
 * BIN-848 — push tokens belonging to accounts that Auth no longer honours.
 *
 * `sendPushToUser` gates on the profile doc's `notificationSettings.pushEnabled`
 * and never consults Auth, and a Console disable or delete leaves every Firestore
 * document in place — so a suspended or deleted account's device keeps receiving
 * notifications indefinitely. The client cannot fix it: by the time credentials
 * are revoked it has no permission to delete its own token doc.
 *
 * This is the only one of the five parallel scans whose false positive destroys
 * something a LIVE account is using, so it fails safe in every direction: a
 * rejected lookup batch deletes nothing and leaves the work for tomorrow,
 * "deleted" is read from the response's own `notFound` list rather than inferred
 * from absence, and the other four scans are unaffected by an Auth outage because
 * this one is caught independently by the caller.
 *
 * Cadence note (#27 DBA asked for weekly): kept daily because it lives in a daily
 * function whose stated job this already is. The scan is a projected collection
 * group of a handful of docs, bounded by the same pageSize as its siblings. If
 * device count ever makes it expensive, move the WHOLE function to a sparser
 * schedule rather than hiding a weekly branch inside a daily one.
 */
async function collectRevokedPushTokens(io: CleanupIo): Promise<{
  paths: string[];
  skippedAuthBatches: number;
  checkedUids: number;
}> {
  // uid → its token docs, built in ONE paginated pass.
  const byOwner = new Map<string, string[]>();
  await pageThrough(io, 'fcmTokens', (docs) => {
    for (const d of docs) {
      const uid = tokenOwnerUid(d.path);
      if (!uid) continue;
      const list = byOwner.get(uid);
      if (list) list.push(d.path);
      else byOwner.set(uid, [d.path]);
    }
  });
  if (byOwner.size === 0) return { paths: [], skippedAuthBatches: 0, checkedUids: 0 };

  // A batch that throws (network, quota, an Auth outage) is skipped, never
  // conflated with notFound — the rule revokedUidsInBatches enforces.
  const { revoked, skippedBatches } = await revokedUidsInBatches(
    [...byOwner.keys()],
    (batch) => io.lookupUsers(batch),
    (err, size) => io.log.error('retentionCleanup: getUsers batch failed, skipping', { size, err }),
  );

  const paths: string[] = [];
  for (const uid of revoked) paths.push(...(byOwner.get(uid) ?? []));
  return { paths, skippedAuthBatches: skippedBatches, checkedUids: byOwner.size };
}

/**
 * Which of `uids` are CONFIRMED to have no `users/{uid}` document.
 *
 * A batch that throws contributes nothing and is counted, never conflated with
 * absence — everything downstream of this deletes what it names. A zero here
 * means "nobody was missing" only when `skippedBatches` is also zero. Likewise a
 * uid is only missing when the port said `false` for its slot: a short or
 * misaligned answer leaves it alone rather than guessing.
 */
async function confirmedMissingProfiles(
  io: CleanupIo,
  uids: readonly string[],
): Promise<{ missing: Set<string>; skippedBatches: number }> {
  const missing = new Set<string>();
  let skippedBatches = 0;
  for (const batch of chunkUids([...uids], io.profileBatchSize)) {
    try {
      const exists = await io.profilesExist(batch);
      batch.forEach((uid, i) => { if (exists[i] === false) missing.add(uid); });
    } catch (err) {
      skippedBatches += 1;
      io.log.error('retentionCleanup: users getAll batch failed, skipping', { size: batch.length, err });
    }
  }
  return { missing, skippedBatches };
}

/**
 * BIN-816 / ADR 0019 condition 5b — Firebase Auth accounts left behind by an
 * aborted deletion.
 *
 * The client erases Firestore first and removes the auth user last (it loses
 * every write permission the moment the auth user is gone), so a token that aged
 * out or a dropped connection strands an account whose data is erased and whose
 * identity is not. The device-local marker stops that account's profile being
 * resurrected; it cannot finish the job, and on a second device it does not exist
 * at all. This sweep does, independent of whether the user ever returns — which
 * is what makes the surviving account a documented delay rather than an
 * unfinished erasure (Malin, 2026-08-11).
 *
 * Fails safe like its BIN-848 sibling: candidates must be older than
 * ORPHAN_AUTH_MIN_AGE_MS so a signup whose profile write merely failed is never
 * eaten, absence of `users/{uid}` is read from a lookup that SUCCEEDED, and a
 * failed batch leaves the work for tomorrow.
 */
async function collectOrphanedAuthAccounts(io: CleanupIo, nowMs: number): Promise<{
  uids: string[];
  checkedAccounts: number;
  skippedProfileBatches: number;
}> {
  const candidates: string[] = [];
  let checkedAccounts = 0;
  let pageToken: string | undefined;
  for (;;) {
    const page = await io.listAuthAccounts(pageToken);
    for (const u of page.users) {
      checkedAccounts += 1;
      // Candidacy (age + the disabled skip) lives in orphans.ts; this is paging only.
      if (isOrphanCandidate(u, nowMs)) candidates.push(u.uid);
    }
    if (!page.pageToken) break;
    pageToken = page.pageToken;
  }
  if (candidates.length === 0) return { uids: [], checkedAccounts, skippedProfileBatches: 0 };
  const { missing, skippedBatches } = await confirmedMissingProfiles(io, candidates);
  return { uids: [...missing], checkedAccounts, skippedProfileBatches: skippedBatches };
}

/**
 * BIN-875 / ADR 0020 (Malin's answer 2) — username reservations pointing at an
 * account that no longer exists.
 *
 * `usernames/{name}` is a global reservation holding `{ uid }`, and
 * `docs/data-retention-policy.md` promises outright that deleting an account
 * releases the handle. A cascade interrupted before the reservation was queued
 * broke that promise permanently. The client fix makes a RETRY release it; this
 * covers the user who never retries — and it has to, because the auth sweep above
 * can remove their account first and take the retry away with it.
 *
 * Releases only when the profile document AND the auth account are both confirmed
 * gone. A disabled-but-present account keeps its handle: it still exists, and
 * `absentUidsFromLookup` deliberately does not treat `disabled` as absent the way
 * the push sweep's own predicate does.
 */
async function collectOrphanedUsernames(io: CleanupIo): Promise<{
  paths: string[];
  checkedReservations: number;
  skippedProfileBatches: number;
  skippedAuthBatches: number;
}> {
  const reservations: { name: string; uid: string; path: string }[] = [];
  await pageThrough(io, 'usernames', (docs) => {
    for (const d of docs) {
      const uid = d.data.uid;
      // A reservation with no uid cannot be attributed to anyone, so it cannot be
      // proven orphaned either. Left alone rather than guessed at.
      if (typeof uid === 'string' && uid.length > 0) {
        reservations.push({ name: d.path.split('/').pop() ?? d.path, uid, path: d.path });
      }
    }
  });
  if (reservations.length === 0) {
    return { paths: [], checkedReservations: 0, skippedProfileBatches: 0, skippedAuthBatches: 0 };
  }

  const uids = [...new Set(reservations.map((r) => r.uid))];
  const { missing: profileMissing, skippedBatches: skippedProfileBatches } =
    await confirmedMissingProfiles(io, uids);
  // Only ask Auth about uids whose profile is already confirmed gone — the rest
  // cannot be orphans however Auth answers, and this is a per-uid API call.
  const { revoked: authAbsent, skippedBatches: skippedAuthBatches } = await revokedUidsInBatches(
    uids.filter((uid) => profileMissing.has(uid)),
    (batch) => io.lookupUsers(batch),
    (err, size) => io.log.error('retentionCleanup: usernames getUsers batch failed, skipping', { size, err }),
    // Narrower than the push sweep's default on purpose: a DISABLED account still
    // exists and still owns its handle.
    absentUidsFromLookup,
  );

  return {
    paths: orphanedReservations(reservations, profileMissing, new Set(authAbsent)).map((r) => r.path),
    checkedReservations: reservations.length,
    skippedProfileBatches,
    skippedAuthBatches,
  };
}

/**
 * BIN-1023 — Firestore data whose owner has no Firebase Auth account at all.
 *
 * The sibling sweep above hunts the opposite shape (an auth account with no
 * data). This one exists because `docs/data-retention-policy.md` already names
 * the gap: an account removed from the Firebase Console runs NO client cascade,
 * so every `users/{uid}` document survives an erasure nobody can undo — the
 * owner cannot sign in to retry, and the data is addressable by uid forever.
 *
 * NOT, despite the ticket's own wording, an interrupted client cascade: that
 * path queues the watchlist in `collectDeletionRefs` section 1 and `users/{uid}`
 * in section 9 and commits the chunks strictly in order, so a confirmed-missing
 * profile almost always implies the library went with it. The Console deletion
 * is the shape the tests drive.
 *
 * Three independent brakes, none of which this function decides on its own:
 *  - absence comes from `getUsers()`'s own `notFound` list (`absentUidsFromLookup`),
 *    so a failed batch contributes nobody and a DISABLED account is never absent;
 *  - a uid must read absent on a run at least `ORPHAN_DATA_MIN_OBSERVED_MS`
 *    after the run that first saw it (`partitionOrphanData`), so one bad lookup
 *    cannot erase anything;
 *  - the ceiling (applied by the caller) refuses the whole run if the candidate
 *    set is implausible.
 */
async function collectOrphanedUserData(io: CleanupIo, nowMs: number): Promise<{
  erase: string[];
  stamp: string[];
  clearWatch: string[];
  checkedUserRoots: number;
  skippedAuthBatches: number;
}> {
  const uids = [...(await io.listUserUids())];
  if (uids.length === 0) {
    return { erase: [], stamp: [], clearWatch: [], checkedUserRoots: 0, skippedAuthBatches: 0 };
  }

  const { revoked: authAbsentUids, skippedBatches: skippedAuthBatches } = await revokedUidsInBatches(
    uids,
    (batch) => io.lookupUsers(batch),
    (err, size) => io.log.error('retentionCleanup: orphan data getUsers batch failed, skipping', { size, err }),
    // Existence, not honour: a disabled account still owns its data, exactly as
    // in the username sweep. The push sweep's wider predicate would be wrong here.
    absentUidsFromLookup,
  );

  // The watch collection is bounded by the number of uids ever seen absent, so
  // it is read whole rather than paged per-uid. `firstSeenAt` is stored as
  // milliseconds by `stampOrphanWatch`, so it needs no Timestamp conversion —
  // but an absent or non-numeric value must read as null, which
  // `isObservedLongEnough` treats as "stamp again", never as "old enough".
  const firstSeenAt = new Map<string, number | null>();
  await pageThrough(io, 'orphanWatch', (docs) => {
    for (const d of docs) {
      const uid = d.path.split('/').pop();
      if (!uid) continue;
      const raw = d.data.firstSeenAt;
      firstSeenAt.set(uid, typeof raw === 'number' ? raw : null);
    }
  });

  const parts = partitionOrphanData(uids, new Set(authAbsentUids), firstSeenAt, nowMs);
  return { ...parts, checkedUserRoots: uids.length, skippedAuthBatches };
}

/**
 * Erase one orphaned owner's data; never throw.
 *
 * Order is load-bearing. `publicProfiles/{uid}` goes FIRST because it lives
 * outside the `users/{uid}` path tree: once the tree is gone the uid stops
 * appearing in `listUserUids`, and a projection left behind would be
 * unreachable by any later run — publicly readable, and permanently.
 *
 * The watch record goes LAST, and only after both succeeded. A failure while
 * ERASING leaves the record in place with its original `firstSeenAt`, and the
 * uid still in `listUserUids`, so the next run retries immediately rather than
 * restarting a three-day clock. A failure deleting the RECORD itself is a
 * different case with a different outcome — see that catch block.
 */
async function eraseOrphanedUserData(io: CleanupIo, uid: string): Promise<boolean> {
  try {
    await io.deleteDocs([`publicProfiles/${uid}`]);
    await io.deleteUserTree(uid);
  } catch (err) {
    io.log.error('retentionCleanup: orphan data erase failed, watch record kept for retry', { uid, err });
    return false;
  }
  try {
    await io.deleteDocs([`orphanWatch/${uid}`]);
  } catch (err) {
    // The data is gone, which is the point, so this must not be reported as a
    // failed erase. The record does leak permanently rather than being retried:
    // the uid no longer appears in `listUserUids`, and `partitionOrphanData`
    // only ever iterates uids from there. One small document, on a double
    // failure, holding nothing but a timestamp.
    io.log.error('retentionCleanup: orphan data erased but watch record survived', { uid, err });
  }
  return true;
}

/**
 * Delete each session tree (doc + participants/* + swipes/*); never throw.
 * Serial on purpose — steady state is tiny (sessions TTL at 7 days, this runs
 * daily).
 */
async function deleteSessions(io: CleanupIo, paths: readonly string[]): Promise<number> {
  let deleted = 0;
  for (const path of paths) {
    try {
      await io.deleteSessionTree(path);
      deleted += 1;
    } catch (err) {
      io.log.error('retentionCleanup: session recursiveDelete failed', { path, err });
    }
  }
  return deleted;
}

/** Delete leaf docs in ≤deleteBatchSize chunks; log batch failures, never throw. */
async function deleteInBatches(io: CleanupIo, paths: readonly string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < paths.length; i += io.deleteBatchSize) {
    const chunk = paths.slice(i, i + io.deleteBatchSize);
    try {
      await io.deleteDocs(chunk);
      deleted += chunk.length;
    } catch (err) {
      // One failed commit must not abandon the chunks after it, and must not be
      // counted as deleted.
      io.log.error('retentionCleanup: batch delete failed', err);
    }
  }
  return deleted;
}

/** Remove auth accounts, behind the blast-radius ceiling; log failures, never throw. */
async function deleteAuthAccounts(
  io: CleanupIo,
  uids: readonly string[],
  checkedAccounts: number,
): Promise<number> {
  if (uids.length === 0) return 0;
  // Every other guard here answers "what if a check failed"; this one answers
  // "what if a check succeeded and was wrong". The decision itself lives in
  // orphans.ts, and production deletes what it RETURNS — so a bypass has to
  // change what this iterates rather than drop a guard clause.
  const { allowed, refused } = withinOrphanCeiling([...uids], checkedAccounts);
  if (refused) {
    io.log.error('retentionCleanup: orphan auth sweep exceeded its ceiling — deleting NOTHING', {
      candidates: uids.length,
      checkedAccounts,
      hint: 'verify collectOrphanedAuthAccounts against docs/data-retention-policy.md before raising this',
    });
    return 0;
  }
  let deleted = 0;
  for (const batch of chunkUids(allowed, AUTH_DELETE_BATCH)) {
    try {
      const res = await io.deleteAuthUsers(batch);
      // Read from the response, not assumed from a resolved promise: deleteUsers
      // reports per-uid failures without rejecting, so counting the batch size
      // would over-report.
      deleted += res.successCount;
      if (res.failureCount > 0) {
        io.log.error('retentionCleanup: some auth deletions failed', {
          failureCount: res.failureCount,
          errors: res.errors.map((e) => e.message),
        });
      }
    } catch (err) {
      io.log.error('retentionCleanup: deleteUsers batch failed', { size: batch.length, err });
    }
  }
  return deleted;
}

/**
 * One retentionCleanup invocation. Never throws: EVERY sweep is caught on its
 * own so a single failure — an Auth outage, a missing index — cannot starve the
 * rest. Returns the same record it logs.
 *
 * No count here on purpose: a number in this very sentence went stale when a
 * sweep was added and had to be struck. Read the body if you need the roster —
 * a `grep` for catch handlers counts more than the sweeps, so there is no
 * one-liner that answers it honestly.
 */
export async function runRetentionCleanup(io: CleanupIo): Promise<CleanupSummary> {
  const nowMs = io.now();

  const [expiredSessions, staleNotifications, staleJoinAttempts, staleReleaseMarkers, revokedPushTokens] =
    await Promise.all([
      collectExpiredSessions(io, nowMs).catch((err) => {
        io.log.error('retentionCleanup: sessions scan failed', err);
        return [] as string[];
      }),
      collectStaleByField(io, 'notifications', 'createdAt', isStaleNotification, nowMs).catch((err) => {
        io.log.error('retentionCleanup: notifications scan failed', err);
        return [] as string[];
      }),
      collectStaleByField(io, 'joinAttempts', 'createdAt', isStaleJoinAttempt, nowMs).catch((err) => {
        io.log.error('retentionCleanup: joinAttempts scan failed', err);
        return [] as string[];
      }),
      collectStaleByField(io, 'releaseMarkers', 'updatedAt', isStaleReleaseMarker, nowMs).catch((err) => {
        io.log.error('retentionCleanup: releaseMarkers scan failed', err);
        return [] as string[];
      }),
      collectRevokedPushTokens(io).catch((err) => {
        io.log.error('retentionCleanup: revoked push token scan failed', err);
        // -1, not 0: the whole scan died, so nothing was checked. A 0 here would
        // make the summary byte-identical to a run where nobody was revoked,
        // which is the exact ambiguity this field exists to remove.
        return { paths: [] as string[], skippedAuthBatches: -1, checkedUids: 0 };
      }),
    ]);

  const deletedSessions = await deleteSessions(io, expiredSessions);
  const deletedNotifications = await deleteInBatches(io, staleNotifications);
  const deletedJoinAttempts = await deleteInBatches(io, staleJoinAttempts);
  const deletedReleaseMarkers = await deleteInBatches(io, staleReleaseMarkers);
  const deletedRevokedTokens = await deleteInBatches(io, revokedPushTokens.paths);

  // The sweeps above are done; say so BEFORE the ones below start. Those reach
  // Auth and can be the first casualty of the 300s budget, and a run that times
  // out inside them would otherwise print no summary at all. No count here: this
  // sentence has carried a stale one every time a sweep was added.
  io.log.info('retentionCleanup: scheduled sweeps done', {
    expiredSessions: expiredSessions.length,
    deletedSessions,
    staleNotifications: staleNotifications.length,
    deletedNotifications,
    staleJoinAttempts: staleJoinAttempts.length,
    deletedJoinAttempts,
    staleReleaseMarkers: staleReleaseMarkers.length,
    deletedReleaseMarkers,
    revokedPushTokens: revokedPushTokens.paths.length,
    deletedRevokedTokens,
  });

  // BIN-816 / BIN-875 — the aborted-deletion sweeps. Sequential and in this
  // order, unlike the block above: removing the orphaned auth accounts first lets
  // the username sweep see them as gone and release their handles in the SAME run
  // instead of a day later. Each is caught on its own.
  const orphanAuth = await collectOrphanedAuthAccounts(io, nowMs).catch((err) => {
    io.log.error('retentionCleanup: orphaned auth account scan failed', err);
    // -1, like the push sweep: the scan died, so nothing was checked.
    return { uids: [] as string[], checkedAccounts: -1, skippedProfileBatches: -1 };
  });
  const deletedOrphanAuthAccounts = await deleteAuthAccounts(io, orphanAuth.uids, orphanAuth.checkedAccounts);

  const orphanUsernames = await collectOrphanedUsernames(io).catch((err) => {
    io.log.error('retentionCleanup: orphaned username scan failed', err);
    return {
      paths: [] as string[],
      checkedReservations: -1,
      skippedProfileBatches: -1,
      skippedAuthBatches: -1,
    };
  });
  // Same ceiling as the auth sweep, and for the same reason: a released handle is
  // irreversible, and a successful-but-wrong read looks identical to a busy day.
  // The two sweeps are independent, so a refused auth deletion does not stop a
  // release (security review, 2026-08-13).
  const { allowed: releasableUsernames, refused: orphanUsernamesRefused } =
    withinOrphanCeiling(orphanUsernames.paths, orphanUsernames.checkedReservations);
  if (orphanUsernamesRefused) {
    io.log.error('retentionCleanup: orphan username sweep exceeded its ceiling — releasing NOTHING', {
      candidates: orphanUsernames.paths.length,
      checkedReservations: orphanUsernames.checkedReservations,
    });
  }
  const deletedOrphanUsernames = await deleteInBatches(io, releasableUsernames);

  // BIN-1023 — LAST, and after the auth sweep on purpose. Deletion still waits
  // for the observation floor, so nothing is erased on the strength of one
  // reading.
  const orphanData = await collectOrphanedUserData(io, nowMs).catch((err) => {
    io.log.error('retentionCleanup: orphaned user-data scan failed', err);
    // -1 for both, like every sibling: the scan died, so nothing was checked and
    // the zeros below must not read as "everyone has an account".
    return {
      erase: [] as string[],
      stamp: [] as string[],
      clearWatch: [] as string[],
      checkedUserRoots: -1,
      skippedAuthBatches: -1,
    };
  });
  // The same ceiling, for the sharpest version of the same reason: this sweep
  // recursively deletes a person's entire library. A successful-but-wrong read —
  // a wrong project id, an Auth outage answering `notFound` for everyone — looks
  // exactly like a busy day, and the run is unrecoverable.
  const { allowed: erasableUids, refused: orphanDataRefused } =
    withinOrphanCeiling(orphanData.erase, orphanData.checkedUserRoots);
  if (orphanDataRefused) {
    io.log.error('retentionCleanup: orphan data sweep exceeded its ceiling — erasing NOTHING', {
      candidates: orphanData.erase.length,
      checkedUserRoots: orphanData.checkedUserRoots,
      hint: 'verify the getUsers lookup before raising this — the ceiling is the only backstop left, rules do not apply to the Admin SDK',
    });
  }
  let erasedOrphanDataUids = 0;
  for (const uid of erasableUids) {
    if (await eraseOrphanedUserData(io, uid)) erasedOrphanDataUids += 1;
  }
  // Stamping and clearing run whether or not the ceiling refused: both are
  // non-destructive bookkeeping, and a refused run that also skipped them would
  // never build the observation history a later run needs.
  let stampedOrphanDataUids = 0;
  for (const batch of chunkUids(orphanData.stamp, io.deleteBatchSize)) {
    try {
      await io.stampOrphanWatch(batch, nowMs);
      // Counted AFTER the commit, like every sibling counter here. Counting the
      // intent instead would make a run whose stamps never commit — a denied
      // write, a quota — look identical to the healthy day after a Console
      // deletion, and that run re-stamps forever and erases nothing. The runbook
      // tells the operator to wait out the window on that signature.
      stampedOrphanDataUids += batch.length;
    } catch (err) {
      io.log.error('retentionCleanup: orphan watch stamp failed', { size: batch.length, err });
    }
  }
  const clearedOrphanDataWatches = await deleteInBatches(
    io,
    orphanData.clearWatch.map((uid) => `orphanWatch/${uid}`),
  );

  const summary: CleanupSummary = {
    expiredSessions: expiredSessions.length,
    deletedSessions,
    staleNotifications: staleNotifications.length,
    deletedNotifications,
    staleJoinAttempts: staleJoinAttempts.length,
    deletedJoinAttempts,
    staleReleaseMarkers: staleReleaseMarkers.length,
    deletedReleaseMarkers,
    revokedPushTokens: revokedPushTokens.paths.length,
    deletedRevokedTokens,
    // >0: some uids went unchecked. -1: the scan itself died, nothing was checked
    // at all. Either way the zero above is "unknown", not "nobody was revoked".
    skippedAuthBatches: revokedPushTokens.skippedAuthBatches,
    // Pairs with the line above: `skippedAuthBatches: 0` only means "Auth answered
    // for everyone" when this is non-zero.
    checkedUids: revokedPushTokens.checkedUids,
    // BIN-816: same reading rule. `orphanAuthAccounts: 0` is "none found" only
    // when checkedAuthAccounts > 0 and the skipped count is 0.
    orphanAuthAccounts: orphanAuth.uids.length,
    deletedOrphanAuthAccounts,
    checkedAuthAccounts: orphanAuth.checkedAccounts,
    orphanAuthSkippedProfileBatches: orphanAuth.skippedProfileBatches,
    // BIN-875: ditto — a released handle is irreversible, so "we checked and found
    // none" and "we could not check" must not print the same line.
    orphanUsernames: orphanUsernames.paths.length,
    deletedOrphanUsernames,
    checkedReservations: orphanUsernames.checkedReservations,
    orphanUsernameSkippedProfileBatches: orphanUsernames.skippedProfileBatches,
    orphanUsernameSkippedAuthBatches: orphanUsernames.skippedAuthBatches,
    // BIN-1023: same reading rule again, and here it matters most — this is the
    // one sweep that recursively deletes a library. `orphanDataUids: 0` means
    // "nobody's account is missing" only when checkedUserRoots > 0 AND
    // orphanDataSkippedAuthBatches is 0; otherwise it means "we do not know".
    orphanDataUids: orphanData.erase.length,
    erasedOrphanDataUids,
    checkedUserRoots: orphanData.checkedUserRoots,
    // Absent uids seen for the FIRST time this run: recorded, deliberately not
    // erased. A non-zero here with a zero above is the healthy steady state on
    // the day after a Console deletion, not a stalled sweep.
    watchedOrphanDataUids: stampedOrphanDataUids,
    // Watch records dropped because the uid read PRESENT again — a returning
    // account, or an earlier lookup that was simply wrong.
    clearedOrphanDataWatches,
    orphanDataSkippedAuthBatches: orphanData.skippedAuthBatches,
  };
  io.log.info('retentionCleanup done', summary);
  return summary;
}
