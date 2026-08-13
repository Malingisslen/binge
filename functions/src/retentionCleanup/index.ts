/**
 * Scheduled retention cleanup (BIN-65).
 *
 * onSchedule('every 24 hours', europe-west1). Deletes data past the thresholds
 * in docs/data-retention-policy.md so it doesn't accumulate forever — growing
 * Firestore storage + read cost on the 25 SEK/mån cap, and holding data longer
 * than the policy allows:
 *   - sessions/{id}        — past `expiresAt`, or (legacy, no expiresAt) >30 days
 *   - users/{uid}/notifications/{id} — older than 90 days
 *   - groups/{id}/joinAttempts/{uid} — older than 1 hour (BIN-329): a spent
 *     plaintext invite token left by an abandoned/failed-cleanup token-join, or
 *     by an account deleted via the Firebase Console (which runs no client
 *     cascade). This is the permanent erasure backstop for that secret.
 *   - releaseNotifyState/{tmdbId}/notified/{uid} — older than 30 days (BIN-464):
 *     the per-user "släpps idag" dedup marker. Admin-only (no firestore.rules
 *     match), so the client account-deletion cascade cannot reach it — this sweep
 *     is its SOLE GDPR Art. 17 erasure path AND its growth bound, covering
 *     self-service, abandoned and Console-deleted accounts alike.
 *   - Firebase Auth accounts with no matching users/{uid} document, older than
 *     7 days (BIN-816, ADR 0019 condition 5b): an account deletion erases
 *     Firestore first and removes the auth user last, so anything that kills the
 *     second half strands an identity whose data is already gone. The client's
 *     device-local marker stops that profile being resurrected but cannot finish
 *     the erasure, and does not exist on another device at all. This sweep is
 *     what makes the surviving account a documented DELAY under Art. 12(3)
 *     rather than an unfinished Art. 17 request — Malin's decision 2026-08-11,
 *     conditional on this running. See docs/data-retention-policy.md.
 *   - usernames/{name} whose uid resolves to neither a users/{uid} document nor
 *     a live auth account (BIN-875, ADR 0020): the reservation used to be
 *     resolved from the profile document the first attempt had already deleted,
 *     so an interrupted cascade left a handle taken forever by an account that
 *     does not exist — against this policy's own "hård radering + release"
 *     promise. The client fix makes a RETRY release it; this covers the user who
 *     never retries, including the one whose account the sweep above removed.
 *   - users/{uid}/fcmTokens/* — for uids Auth no longer honours (BIN-848): the
 *     account was deleted or disabled from the Firebase Console, which leaves
 *     every Firestore doc in place, so sendPushToUser (which gates on the profile
 *     doc, never on Auth) keeps pushing to that person's device forever. FCM's own
 *     self-heal misses it because the token is still valid on a live browser. Note
 *     this sweep is NOT about sessions merely lapsing — a closed browser must keep
 *     receiving push; that is the point of push.
 *
 * Sessions own subcollections (participants/*, swipes/*), so a plain doc delete
 * would orphan them — we use recursiveDelete() to reap the whole session tree.
 * Notifications are leaf docs → chunked batch delete.
 *
 * Bounded pagination (PAGE_SIZE) + per-page filtering mirrors reclaimOrphanFollows
 * (BIN-50): never load a whole collection in one query result; peak memory stays
 * page-size + matches. Idempotent — a second run finds nothing. The Admin SDK
 * bypasses firestore.rules.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import type { DocumentReference, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { isExpiredSession, isStaleNotification, isStaleJoinAttempt, isStaleReleaseMarker, tsToMillis, revokedUidsInBatches, chunkUids } from './logic';
import { absentUidsFromLookup, orphanedReservations, withinOrphanCeiling, isOrphanCandidate } from './orphans';

/** Firestore's per-commit write ceiling is 500; leave headroom like the client. */
const BATCH_SIZE = 450;

/** Page size for the bounded scans — never load a whole collection at once. */
const PAGE_SIZE = 2000;

/** Sessions past their TTL, scanned in bounded pages and filtered per page. */
async function collectExpiredSessions(nowMs: number): Promise<DocumentReference[]> {
  const db = getFirestore();
  const refs: DocumentReference[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    // select('expiresAt','createdAt') is load-bearing: these feed tsToMillis →
    // isExpiredSession. Drop/misspell either and every session reads as
    // undateable → isExpiredSession returns false → nothing is reaped. Keep them.
    let q = db.collection('sessions').select('expiresAt', 'createdAt').orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      if (isExpiredSession(tsToMillis(d.get('expiresAt')), tsToMillis(d.get('createdAt')), nowMs)) {
        refs.push(d.ref);
      }
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return refs;
}

/** Notifications older than the threshold, across all users (collection group). */
async function collectStaleNotifications(nowMs: number): Promise<DocumentReference[]> {
  const db = getFirestore();
  const refs: DocumentReference[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    // select('createdAt') is load-bearing (see collectExpiredSessions). The
    // orderBy('__name__') uses Firestore's automatic collection-group __name__
    // index — no firestore.indexes.json entry needed (a single-field __name__
    // index isn't a composite). If that ever changes, the handler's .catch logs
    // "notifications scan failed" rather than silently reaping nothing.
    let q = db.collectionGroup('notifications').select('createdAt').orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      if (isStaleNotification(tsToMillis(d.get('createdAt')), nowMs)) refs.push(d.ref);
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return refs;
}

/** joinAttempts older than the TTL, across all groups (collection group). */
async function collectStaleJoinAttempts(nowMs: number): Promise<DocumentReference[]> {
  const db = getFirestore();
  const refs: DocumentReference[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    // Same bounded, index-free pattern as collectStaleNotifications: select only
    // createdAt and page by __name__ (automatic collection-group index — no
    // firestore.indexes.json entry needed). joinAttempts are leaf docs.
    let q = db.collectionGroup('joinAttempts').select('createdAt').orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      if (isStaleJoinAttempt(tsToMillis(d.get('createdAt')), nowMs)) refs.push(d.ref);
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return refs;
}

/**
 * Release-notify dedup markers (BIN-464) older than the TTL, across all titles
 * (collection group `notified`). GDPR Art. 17 erasure path for this uid-keyed,
 * admin-only marker: the client account-deletion cascade cannot reach
 * `releaseNotifyState/{tmdbId}/notified/{uid}` (no firestore.rules match →
 * default-denied), so this sweep is the sole eraser — same role the joinAttempts
 * sweep plays, and it covers Console-deleted accounts too.
 */
async function collectStaleReleaseMarkers(nowMs: number): Promise<DocumentReference[]> {
  const db = getFirestore();
  const refs: DocumentReference[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    // Same bounded, index-free pattern as collectStaleJoinAttempts: select only
    // the age field and page by __name__ (automatic collection-group index — no
    // firestore.indexes.json entry needed). Markers are leaf docs. Note the age
    // field here is `updatedAt` (what the marker stamps), not `createdAt`.
    let q = db.collectionGroup('notified').select('updatedAt').orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      if (isStaleReleaseMarker(tsToMillis(d.get('updatedAt')), nowMs)) refs.push(d.ref);
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return refs;
}

/**
 * BIN-848 — push tokens belonging to accounts that Auth no longer honours.
 *
 * `sendPushToUser` gates on the profile doc's `notificationSettings.pushEnabled`
 * and never consults Auth, and a Console disable or delete leaves every Firestore
 * document in place — so a suspended or deleted account's device keeps receiving
 * notifications indefinitely. FCM's own self-heal cannot catch it either: the
 * token is still perfectly valid on a live browser, so nothing ever comes back
 * `registration-token-not-registered`.
 *
 * The client cannot fix this. By the time credentials are revoked it has no
 * permission to delete its own token doc — which is why this belongs in the same
 * sweep that already backstops "accounts deleted via the Firebase Console, which
 * run no client cascade".
 *
 * This is the ONLY scan here whose false positive destroys something a LIVE
 * account is using, so it fails safe in every direction: a rejected `getUsers()`
 * batch deletes nothing and leaves the work for tomorrow, "deleted" is read from
 * the response's own `notFound` list rather than inferred from absence, and the
 * other four scans are unaffected by an Auth outage because this one is caught
 * independently in the handler.
 *
 * Note the IAM surface has grown since this comment was written: the aborted-
 * deletion sweep below also calls `listUsers` and `deleteUsers`, so
 * `firebaseauth.users.delete` is now required too. See
 * docs/analysis/EXTERNAL_ACTIONS.md — a missing role makes those batches throw
 * while the deploy stays green.
 *
 * Cadence note (#27 DBA asked for weekly): kept daily because it lives in a daily
 * function whose stated job this already is. The scan is a `.select()`-ed
 * collection group of a handful of docs, bounded by the same PAGE_SIZE as its
 * siblings. If device count ever makes it expensive, move the WHOLE function to a
 * sparser schedule rather than hiding a weekly branch inside a daily one.
 */
async function collectRevokedPushTokens(): Promise<{
  refs: DocumentReference[];
  skippedAuthBatches: number;
  /**
   * How many uids were actually put to Auth. Logged because without it a run
   * that checked nothing (no token docs at all, or the scan died) is
   * indistinguishable from a healthy run that checked everyone and found them
   * all live — and that is the exact reading the post-deploy permission check
   * depends on: this sweep is the only caller of an Auth user-management API in
   * this codebase, and a missing IAM role makes it silently inert while the
   * deploy stays green. Acceptance bar and the remedy live in
   * docs/analysis/EXTERNAL_ACTIONS.md's post-deploy block.
   */
  checkedUids: number;
}> {
  const db = getFirestore();
  // uid → its token docs. Built in ONE paginated pass; the owner uid comes from
  // the ref (fcmTokens is always users/{uid}/fcmTokens/{tokenId}), the same
  // derivation reclaimOrphanFollows uses, so no field needs selecting.
  const byOwner = new Map<string, DocumentReference[]>();
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    // Same bounded, index-free pattern as the sweeps above: page by __name__ on
    // the automatic collection-group index. `.select()` with no fields returns
    // refs only — this scan never reads a token value.
    let q = db.collectionGroup('fcmTokens').select().orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const ownerUid = d.ref.parent.parent?.id;
      if (!ownerUid) continue;
      const list = byOwner.get(ownerUid);
      if (list) list.push(d.ref);
      else byOwner.set(ownerUid, [d.ref]);
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  if (byOwner.size === 0) return { refs: [], skippedAuthBatches: 0, checkedUids: 0 };

  const auth = getAuth();
  // A batch that throws (network, quota, an Auth outage) is skipped, never
  // conflated with notFound — see revokedUidsInBatches, where that decision is
  // tested without Admin Auth.
  const { revoked, skippedBatches } = await revokedUidsInBatches(
    [...byOwner.keys()],
    (batch) => auth.getUsers(batch.map((uid) => ({ uid }))),
    (err, size) => logger.error('retentionCleanup: getUsers batch failed, skipping', { size, err }),
  );

  const refs: DocumentReference[] = [];
  for (const uid of revoked) refs.push(...(byOwner.get(uid) ?? []));
  return { refs, skippedAuthBatches: skippedBatches, checkedUids: byOwner.size };
}

/** How many document refs to put to a single `getAll()`. */
const GET_ALL_BATCH = 300;

/**
 * Which of `uids` are CONFIRMED to have no `users/{uid}` document.
 *
 * A batch that throws contributes nothing and is counted, never conflated with
 * absence — the same rule `revokedUidsInBatches` follows and for the same
 * reason: everything downstream of this deletes what it names. A zero here
 * means "nobody was missing" only when `skippedBatches` is also zero.
 */
async function confirmedMissingProfiles(
  uids: string[],
): Promise<{ missing: Set<string>; skippedBatches: number }> {
  const db = getFirestore();
  const missing = new Set<string>();
  let skippedBatches = 0;
  for (const batch of chunkUids(uids, GET_ALL_BATCH)) {
    try {
      const snaps = await db.getAll(...batch.map((uid) => db.doc(`users/${uid}`)));
      snaps.forEach((snap, i) => { if (!snap.exists) missing.add(batch[i]); });
    } catch (err) {
      skippedBatches += 1;
      logger.error('retentionCleanup: users getAll batch failed, skipping', { size: batch.length, err });
    }
  }
  return { missing, skippedBatches };
}

/**
 * BIN-816 / ADR 0019 condition 5b — Firebase Auth accounts left behind by an
 * aborted deletion.
 *
 * The client erases Firestore first and removes the auth user last (it loses
 * every write permission the moment the auth user is gone), so a token that
 * aged out or a dropped connection strands an account whose data is erased and
 * whose identity is not. The device-local marker stops that account's profile
 * being resurrected; it cannot finish the job, and on a second device it does
 * not exist at all. This does, independent of whether the user ever returns —
 * which is what makes the surviving account a documented delay rather than an
 * unfinished erasure (Malin, 2026-08-11).
 *
 * Fails safe in every direction, like its BIN-848 sibling: candidates must be
 * older than ORPHAN_AUTH_MIN_AGE_MS so a signup whose profile write merely
 * failed is never eaten, absence of `users/{uid}` is read from a getAll that
 * SUCCEEDED, and a failed batch leaves the work for tomorrow.
 */
async function collectOrphanedAuthAccounts(nowMs: number): Promise<{
  uids: string[];
  checkedAccounts: number;
  skippedProfileBatches: number;
}> {
  const auth = getAuth();
  const candidates: string[] = [];
  let checkedAccounts = 0;
  let pageToken: string | undefined;
  for (;;) {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      checkedAccounts += 1;
      // Candidacy (age + the disabled skip) lives in orphans.ts so it is testable
      // without firebase-admin — this loop is only the paging.
      if (isOrphanCandidate(u, nowMs)) candidates.push(u.uid);
    }
    if (!page.pageToken) break;
    pageToken = page.pageToken;
  }
  if (candidates.length === 0) return { uids: [], checkedAccounts, skippedProfileBatches: 0 };
  const { missing, skippedBatches } = await confirmedMissingProfiles(candidates);
  return { uids: [...missing], checkedAccounts, skippedProfileBatches: skippedBatches };
}

/**
 * BIN-875 / ADR 0020 (Malin's answer 2) — username reservations pointing at an
 * account that no longer exists.
 *
 * `usernames/{name}` is a global reservation holding `{ uid }`, and
 * `docs/data-retention-policy.md` promises outright that deleting an account
 * releases the handle. A cascade interrupted before the reservation was queued
 * broke that promise permanently: the handle stayed taken by an account that
 * does not exist, and nothing in the codebase ever looked for one.
 *
 * The client fix (querying `usernames` on uid, BIN-875) makes a RETRY release
 * it. This covers the user who never retries — and it has to, because the auth
 * sweep above can remove their account first and take the retry away with it.
 *
 * Releases only when the profile document AND the auth account are both
 * confirmed gone. A disabled-but-present account keeps its handle: it still
 * exists, and `absentUidsFromLookup` deliberately does not treat `disabled` as
 * absent the way the push sweep's own predicate does.
 */
async function collectOrphanedUsernames(): Promise<{
  refs: DocumentReference[];
  checkedReservations: number;
  skippedProfileBatches: number;
  skippedAuthBatches: number;
}> {
  const db = getFirestore();
  const reservations: { name: string; uid: string; ref: DocumentReference }[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    // Same bounded, index-free pattern as the sweeps above: select only the
    // field we read and page by __name__ on the automatic index.
    let q = db.collection('usernames').select('uid').orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const uid = d.get('uid');
      // A reservation with no uid cannot be attributed to anyone, so it cannot
      // be proven orphaned either. Left alone rather than guessed at.
      if (typeof uid === 'string' && uid.length > 0) {
        reservations.push({ name: d.id, uid, ref: d.ref });
      }
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  if (reservations.length === 0) {
    return { refs: [], checkedReservations: 0, skippedProfileBatches: 0, skippedAuthBatches: 0 };
  }

  const uids = [...new Set(reservations.map((r) => r.uid))];
  const { missing: profileMissing, skippedBatches: skippedProfileBatches } =
    await confirmedMissingProfiles(uids);
  // Only ask Auth about uids whose profile is already confirmed gone — the rest
  // cannot be orphans however Auth answers, and this is a per-uid API call.
  const auth = getAuth();
  const { revoked: authAbsent, skippedBatches: skippedAuthBatches } = await revokedUidsInBatches(
    uids.filter((uid) => profileMissing.has(uid)),
    (batch) => auth.getUsers(batch.map((uid) => ({ uid }))),
    (err, size) => logger.error('retentionCleanup: usernames getUsers batch failed, skipping', { size, err }),
    absentUidsFromLookup,
  );

  return {
    refs: orphanedReservations(reservations, profileMissing, new Set(authAbsent)).map((r) => r.ref),
    checkedReservations: reservations.length,
    skippedProfileBatches,
    skippedAuthBatches,
  };
}

/**
 * recursiveDelete each session (doc + participants/* + swipes/*); never throw.
 * Serial on purpose — steady-state is tiny (sessions TTL at 7 days, this runs
 * daily). If expired-session volume ever spikes past ~few hundred per run, the
 * 300s timeout could bite; fan out via Cloud Tasks (one task per ref) then.
 */
async function deleteSessions(refs: DocumentReference[]): Promise<number> {
  const db = getFirestore();
  let deleted = 0;
  for (const ref of refs) {
    try {
      await db.recursiveDelete(ref);
      deleted += 1;
    } catch (err) {
      logger.error('retentionCleanup: session recursiveDelete failed', { id: ref.id, err });
    }
  }
  return deleted;
}

/**
 * Remove Firebase Auth accounts in ≤1000-uid batches (the API's own ceiling);
 * log failures, never throw. `successCount` is read from the response rather
 * than assumed from a resolved promise — `deleteUsers` reports per-uid failures
 * without rejecting, so counting the batch size would over-report.
 */
async function deleteAuthAccounts(uids: string[], checkedAccounts: number): Promise<number> {
  if (uids.length === 0) return 0;
  // The blast-radius ceiling. Every other guard here answers "what if a check
  // failed"; this one answers "what if a check succeeded and was wrong" — a
  // renamed collection or an inverted predicate makes every candidate read
  // legitimately absent, and then nothing else in this file stands between that
  // mistake and deleting every account older than a week, once, irreversibly.
  // The decision itself lives in orphans.ts so it can be tested; see there for
  // why it is both an absolute and a proportional bound.
  const { allowed, refused } = withinOrphanCeiling(uids, checkedAccounts);
  if (refused) {
    logger.error('retentionCleanup: orphan auth sweep exceeded its ceiling — deleting NOTHING', {
      candidates: uids.length,
      checkedAccounts,
      hint: 'verify collectOrphanedAuthAccounts against docs/data-retention-policy.md before raising this',
    });
    return 0;
  }
  const auth = getAuth();
  let deleted = 0;
  for (const batch of chunkUids(allowed, 1000)) {
    try {
      const res = await auth.deleteUsers(batch);
      deleted += res.successCount;
      if (res.failureCount > 0) {
        logger.error('retentionCleanup: some auth deletions failed', {
          failureCount: res.failureCount,
          errors: res.errors.map((e) => e.error.message),
        });
      }
    } catch (err) {
      logger.error('retentionCleanup: deleteUsers batch failed', { size: batch.length, err });
    }
  }
  return deleted;
}

/** Delete leaf docs in ≤BATCH_SIZE chunks; log batch failures, never throw. */
async function deleteInBatches(refs: DocumentReference[]): Promise<number> {
  const db = getFirestore();
  let deleted = 0;
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const chunk = refs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((ref) => batch.delete(ref));
    try {
      await batch.commit();
      deleted += chunk.length;
    } catch (err) {
      logger.error('retentionCleanup: batch delete failed', err);
    }
  }
  return deleted;
}

export const retentionCleanup = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const nowMs = Date.now();

    const [expiredSessions, staleNotifications, staleJoinAttempts, staleReleaseMarkers, revokedPushTokens] = await Promise.all([
      collectExpiredSessions(nowMs).catch((err) => {
        logger.error('retentionCleanup: sessions scan failed', err);
        return [] as DocumentReference[];
      }),
      collectStaleNotifications(nowMs).catch((err) => {
        logger.error('retentionCleanup: notifications scan failed', err);
        return [] as DocumentReference[];
      }),
      collectStaleJoinAttempts(nowMs).catch((err) => {
        logger.error('retentionCleanup: joinAttempts scan failed', err);
        return [] as DocumentReference[];
      }),
      collectStaleReleaseMarkers(nowMs).catch((err) => {
        logger.error('retentionCleanup: releaseMarkers scan failed', err);
        return [] as DocumentReference[];
      }),
      collectRevokedPushTokens().catch((err) => {
        // Caught here, like its siblings, so an Auth outage cannot starve the
        // four Firestore-only sweeps.
        logger.error('retentionCleanup: revoked push token scan failed', err);
        // -1, not 0: the whole scan died (the collection-group query, or
        // getAuth() itself), so nothing was checked. A 0 here would make the
        // summary line byte-identical to a run where nobody was revoked, which
        // is the exact ambiguity this field exists to remove.
        return { refs: [] as DocumentReference[], skippedAuthBatches: -1, checkedUids: 0 };
      }),
    ]);

    const deletedSessions = await deleteSessions(expiredSessions);
    const deletedNotifications = await deleteInBatches(staleNotifications);
    const deletedJoinAttempts = await deleteInBatches(staleJoinAttempts);
    const deletedReleaseMarkers = await deleteInBatches(staleReleaseMarkers);
    const deletedRevokedTokens = await deleteInBatches(revokedPushTokens.refs);

    // The five sweeps above are done; say so BEFORE the two below start. They
    // page every auth account and can be the first casualty of the 300s budget,
    // and a run that times out inside them would otherwise print no summary at
    // all — losing the record of work that DID complete.
    logger.info('retentionCleanup: scheduled sweeps done', {
      expiredSessions: expiredSessions.length,
      deletedSessions,
      staleNotifications: staleNotifications.length,
      deletedNotifications,
      staleJoinAttempts: staleJoinAttempts.length,
      deletedJoinAttempts,
      staleReleaseMarkers: staleReleaseMarkers.length,
      deletedReleaseMarkers,
      revokedPushTokens: revokedPushTokens.refs.length,
      deletedRevokedTokens,
    });

    // BIN-816 / BIN-875 — the aborted-deletion sweeps. Sequential and in this
    // order, unlike the block above: removing the orphaned auth accounts first
    // lets the username sweep see them as gone and release their handles in the
    // SAME run instead of a day later. Each is caught on its own so neither can
    // starve the other or the five sweeps above.
    const orphanAuth = await collectOrphanedAuthAccounts(nowMs).catch((err) => {
      logger.error('retentionCleanup: orphaned auth account scan failed', err);
      // -1, like the push sweep: the scan died, so nothing was checked. A 0
      // would be byte-identical to a run that checked everyone and found none.
      return { uids: [] as string[], checkedAccounts: -1, skippedProfileBatches: -1 };
    });
    const deletedOrphanAuthAccounts = await deleteAuthAccounts(orphanAuth.uids, orphanAuth.checkedAccounts);

    const orphanUsernames = await collectOrphanedUsernames().catch((err) => {
      logger.error('retentionCleanup: orphaned username scan failed', err);
      return {
        refs: [] as DocumentReference[],
        checkedReservations: -1,
        skippedProfileBatches: -1,
        skippedAuthBatches: -1,
      };
    });
    // Same ceiling as the auth sweep, and for the same reason: a released handle
    // is irreversible, and a successful-but-wrong read looks identical to a busy
    // day. My round-2 reasoning for leaving this uncapped ("the auth side is
    // capped") was wrong — the two sweeps are independent, so a refused auth
    // deletion does not stop a release (security review, 2026-08-13).
    const { allowed: releasableUsernames, refused: orphanUsernamesRefused } =
      withinOrphanCeiling(orphanUsernames.refs, orphanUsernames.checkedReservations);
    if (orphanUsernamesRefused) {
      logger.error('retentionCleanup: orphan username sweep exceeded its ceiling — releasing NOTHING', {
        candidates: orphanUsernames.refs.length,
        checkedReservations: orphanUsernames.checkedReservations,
      });
    }
    const deletedOrphanUsernames = await deleteInBatches(releasableUsernames);

    logger.info('retentionCleanup done', {
      expiredSessions: expiredSessions.length,
      deletedSessions,
      staleNotifications: staleNotifications.length,
      deletedNotifications,
      staleJoinAttempts: staleJoinAttempts.length,
      deletedJoinAttempts,
      staleReleaseMarkers: staleReleaseMarkers.length,
      deletedReleaseMarkers,
      revokedPushTokens: revokedPushTokens.refs.length,
      deletedRevokedTokens,
      // >0: some uids went unchecked. -1: the scan itself died, nothing was
      // checked at all. Either way the zero above is "unknown", not "nobody
      // was revoked".
      skippedAuthBatches: revokedPushTokens.skippedAuthBatches,
      // Pairs with the line above: `skippedAuthBatches: 0` only means "Auth
      // answered for everyone" when this is non-zero. Zero here means there was
      // nothing to ask about.
      checkedUids: revokedPushTokens.checkedUids,
      // BIN-816: same reading rule as the push sweep. `orphanAuthAccounts: 0` is
      // "none found" only when checkedAccounts > 0 and skippedProfileBatches
      // is 0; -1 in either means the scan never ran.
      orphanAuthAccounts: orphanAuth.uids.length,
      deletedOrphanAuthAccounts,
      checkedAuthAccounts: orphanAuth.checkedAccounts,
      orphanAuthSkippedProfileBatches: orphanAuth.skippedProfileBatches,
      // BIN-875: ditto — a released handle is irreversible, so "we checked and
      // found none" and "we could not check" must not print the same line.
      orphanUsernames: orphanUsernames.refs.length,
      deletedOrphanUsernames,
      checkedReservations: orphanUsernames.checkedReservations,
      orphanUsernameSkippedProfileBatches: orphanUsernames.skippedProfileBatches,
      orphanUsernameSkippedAuthBatches: orphanUsernames.skippedAuthBatches,
    });
  },
);
