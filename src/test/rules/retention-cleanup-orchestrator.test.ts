import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, collectionGroup, deleteDoc, doc, documentId, getDoc, getDocs,
  limit, orderBy, query, setDoc, startAfter, Timestamp, writeBatch,
  type Firestore, type Query,
} from 'firebase/firestore';

import {
  runRetentionCleanup,
  type AuthPage,
  type CleanupIo,
  type ScanDoc,
  type ScanKind,
} from '../../../functions/src/retentionCleanup/runCleanup';
import {
  SESSION_MAX_AGE_MS,
  NOTIFICATION_MAX_AGE_MS,
  JOIN_ATTEMPT_MAX_AGE_MS,
  RELEASE_MARKER_MAX_AGE_MS,
  type UserLookupResult,
} from '../../../functions/src/retentionCleanup/logic';
import {
  ORPHAN_AUTH_MIN_AGE_MS,
  ORPHAN_AUTH_MIN_CEILING,
  ORPHAN_AUTH_MAX_FRACTION,
} from '../../../functions/src/retentionCleanup/orphans';

/**
 * BIN-727 — the retentionCleanup ORCHESTRATOR against a real Firestore emulator.
 *
 * The gap this closes (#27 Database Administrator, 2026-08-06 rescope): the
 * sweep's PREDICATES were unit-tested, the loop around them was not. A renamed
 * collection, a dropped page cursor or a swallowed error would have logged
 * "retentionCleanup done" with a zero and nobody would have noticed — on the
 * function that is the SOLE GDPR Art. 17 erasure path for the admin-only
 * `releaseNotifyState/{tmdbId}/notified/{uid}` markers, and the only thing that
 * finishes an aborted account deletion.
 *
 * How it runs without firebase-admin: the loop lives in functions/src/
 * retentionCleanup/runCleanup.ts behind an injected `CleanupIo` port. Prod
 * implements it with the Admin SDK; here the SAME port is implemented with the
 * client SDK against the emulator (CI's rules job installs root deps only, and
 * firebase-admin is not resolvable there). The loop under test is the real one.
 *
 * Auth is a hand-written double rather than the Auth emulator, per #27's
 * condition 1 of 2026-08-13: the three newest sweeps (BIN-848 push tokens,
 * BIN-816 orphaned auth accounts, BIN-875 released usernames) are the ones whose
 * false positive destroys a live person's account, and driving them needs exact
 * control over what `getUsers` answers — including a batch that THROWS, which no
 * emulator can be made to do.
 *
 * The emulator is opened with permissive rules on purpose: in production this
 * sweep runs as the Admin SDK, which bypasses security rules entirely. Pinning
 * rule behaviour is firestore-rules.test.ts's job.
 *
 * NOT proven here, and it cannot be: the `.select()` projection lists live in the
 * Admin port (index.ts) and the client SDK has no equivalent, so this harness
 * reads whole documents — a superset of the projected fields. A wrong projection
 * would starve the predicates in production while every test here stays green.
 * index.ts carries that warning at the projection itself.
 */

const PROJECT_ID = 'binge-retention-orchestrator-test';
const OPEN_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}`;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: OPEN_RULES, host, port: Number(port) },
  });
});
afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

function adminLikeDb(): Firestore {
  return testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
}

/** A fixed "now" — every fixture is placed relative to it, never to the clock. */
const NOW = Date.UTC(2026, 7, 14);
const ts = (ms: number) => Timestamp.fromMillis(ms);
const authAge = (ms: number) => new Date(NOW - ms).toUTCString();

// ─────────────────────────────────────────────────────────────────────────────
// The Auth double
// ─────────────────────────────────────────────────────────────────────────────

interface FakeAccount {
  uid: string;
  disabled?: boolean;
  /** How long before NOW the account was created. */
  ageMs: number;
}

interface FakeAuth {
  /** Uids `deleteUsers` actually removed, in call order. */
  readonly deleted: string[];
  listAuthAccounts(pageToken: string | undefined): Promise<AuthPage>;
  lookupUsers(uids: readonly string[]): Promise<UserLookupResult>;
  deleteAuthUsers(uids: readonly string[]): Promise<{
    successCount: number; failureCount: number; errors: { message: string }[];
  }>;
}

/**
 * An in-memory Firebase Auth. Deliberately literal about the one shape that has
 * bitten this sweep before: a DISABLED account is returned in `users`, never in
 * `notFound` — so any code that reads "gone" as "absent from users" gets it
 * wrong here exactly like it would in production.
 */
function makeAuth(accounts: readonly FakeAccount[], pageSize = 2): FakeAuth {
  const live = new Map(accounts.map((a) => [a.uid, a]));
  const deleted: string[] = [];
  const auth: FakeAuth = {
    deleted,
    listAuthAccounts: async (pageToken) => {
      const all = [...live.values()];
      const start = pageToken ? Number(pageToken) : 0;
      const slice = all.slice(start, start + pageSize);
      const next = start + pageSize < all.length ? String(start + pageSize) : undefined;
      return {
        users: slice.map((a) => ({
          uid: a.uid,
          disabled: a.disabled === true,
          metadata: { creationTime: authAge(a.ageMs) },
        })),
        pageToken: next,
      };
    },
    lookupUsers: async (uids) => {
      const users: { uid: string; disabled?: boolean }[] = [];
      const notFound: { uid: string }[] = [];
      for (const uid of uids) {
        const a = live.get(uid);
        if (a) users.push({ uid: a.uid, disabled: a.disabled === true });
        else notFound.push({ uid });
      }
      return { users, notFound };
    },
    deleteAuthUsers: async (uids) => {
      let successCount = 0;
      for (const uid of uids) {
        if (live.delete(uid)) { deleted.push(uid); successCount += 1; }
      }
      return { successCount, failureCount: uids.length - successCount, errors: [] };
    },
  };
  return auth;
}

// ─────────────────────────────────────────────────────────────────────────────
// The client-SDK port
// ─────────────────────────────────────────────────────────────────────────────

/** Which collection (or collection group) each scan reads. */
const SCAN_SOURCE: Record<ScanKind, { group: boolean; id: string }> = {
  sessions: { group: false, id: 'sessions' },
  notifications: { group: true, id: 'notifications' },
  joinAttempts: { group: true, id: 'joinAttempts' },
  releaseMarkers: { group: true, id: 'notified' },
  fcmTokens: { group: true, id: 'fcmTokens' },
  usernames: { group: false, id: 'usernames' },
};

/**
 * Deliberately tiny page/batch sizes (prod: 2000 / 450 / 300). Every fixture in
 * this file is bigger than one page or one chunk somewhere, so the cursor advance
 * and the chunking are exercised rather than assumed.
 */
const TEST_PAGE_SIZE = 2;
const TEST_DELETE_BATCH = 2;
const TEST_PROFILE_BATCH = 2;

function makeIo(db: Firestore, auth: FakeAuth, overrides: Partial<CleanupIo> = {}): CleanupIo {
  return {
    pageSize: TEST_PAGE_SIZE,
    deleteBatchSize: TEST_DELETE_BATCH,
    profileBatchSize: TEST_PROFILE_BATCH,
    log: { info: () => {}, error: () => {} },
    now: () => NOW,

    scanPage: async (kind, cursor, pageSize): Promise<ScanDoc[]> => {
      const src = SCAN_SOURCE[kind];
      const base = src.group ? collectionGroup(db, src.id) : collection(db, src.id);
      let q: Query = query(base, orderBy(documentId()), limit(pageSize));
      if (cursor) {
        // The port's cursor is a full document PATH. A collection-group query
        // ordered by documentId() takes exactly that; a plain collection query
        // rejects anything containing a slash and wants the bare id. The Admin
        // port sidesteps the split by passing a DocumentReference.
        q = query(q, startAfter(src.group ? cursor : (cursor.split('/').pop() as string)));
      }
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ path: d.ref.path, data: d.data() as Record<string, unknown> }));
    },

    deleteDocs: async (paths) => {
      // A chunk bigger than the batch size would be a real production bug
      // (Firestore rejects >500 writes per commit), so refuse it here rather
      // than let the harness be more forgiving than the database.
      if (paths.length > TEST_DELETE_BATCH) throw new Error(`chunk too large: ${paths.length}`);
      const batch = writeBatch(db);
      for (const path of paths) batch.delete(doc(db, path));
      await batch.commit();
    },

    // The client SDK has no recursiveDelete; this reaps the two subcollections a
    // Tillsammans session owns, which is what the Admin call does for real.
    deleteSessionTree: async (path) => {
      for (const sub of ['participants', 'swipes']) {
        const kids = await getDocs(collection(db, `${path}/${sub}`));
        for (const k of kids.docs) await deleteDoc(k.ref);
      }
      await deleteDoc(doc(db, path));
    },

    profilesExist: async (uids) => {
      if (uids.length > TEST_PROFILE_BATCH) throw new Error(`profile batch too large: ${uids.length}`);
      const out: boolean[] = [];
      for (const uid of uids) out.push((await getDoc(doc(db, 'users', uid))).exists());
      return out;
    },

    lookupUsers: (uids) => auth.lookupUsers(uids),
    listAuthAccounts: (pageToken) => auth.listAuthAccounts(pageToken),
    deleteAuthUsers: (uids) => auth.deleteAuthUsers(uids),

    ...overrides,
  };
}

async function exists(db: Firestore, path: string): Promise<boolean> {
  return (await getDoc(doc(db, path))).exists();
}

// ─────────────────────────────────────────────────────────────────────────────
// The full seven-sweep fixture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One database containing, for every sweep, something it MUST reap and something
 * it MUST leave alone. #27's condition 1: a test that drives only the four
 * harmless Firestore sweeps waves through exactly the code this ticket exists to
 * protect.
 */
async function seedEverything(db: Firestore): Promise<void> {
  // 1. Sessions (own subcollections → tree delete).
  await setDoc(doc(db, 'sessions', 'expired'), { expiresAt: ts(NOW - 1), createdAt: ts(NOW - 1000) });
  await setDoc(doc(db, 'sessions', 'expired', 'participants', 'p1'), { name: 'Anna' });
  await setDoc(doc(db, 'sessions', 'expired', 'swipes', 's1'), { votes: { p1: true } });
  await setDoc(doc(db, 'sessions', 'legacy-old'), { createdAt: ts(NOW - SESSION_MAX_AGE_MS - 1) });
  await setDoc(doc(db, 'sessions', 'live'), { expiresAt: ts(NOW + 60_000), createdAt: ts(NOW - 1000) });
  await setDoc(doc(db, 'sessions', 'undateable'), { note: 'no timestamps at all' });

  // 2. Notifications — one stale, one EXACTLY on the threshold (kept).
  await setDoc(doc(db, 'users', 'alive', 'notifications', 'old'), { createdAt: ts(NOW - NOTIFICATION_MAX_AGE_MS - 1) });
  await setDoc(doc(db, 'users', 'alive', 'notifications', 'onthreshold'), { createdAt: ts(NOW - NOTIFICATION_MAX_AGE_MS) });

  // 3. joinAttempts — the spent plaintext invite token.
  await setDoc(doc(db, 'groups', 'g1', 'joinAttempts', 'gone'), { createdAt: ts(NOW - JOIN_ATTEMPT_MAX_AGE_MS - 1), token: 'spent' });
  await setDoc(doc(db, 'groups', 'g1', 'joinAttempts', 'inflight'), { createdAt: ts(NOW - 60_000), token: 'fresh' });

  // 4. Release-notify dedup markers — keyed on updatedAt, not createdAt.
  await setDoc(doc(db, 'releaseNotifyState', '550', 'notified', 'alive'), { updatedAt: ts(NOW - RELEASE_MARKER_MAX_AGE_MS - 1) });
  await setDoc(doc(db, 'releaseNotifyState', '551', 'notified', 'alive'), { updatedAt: ts(NOW - 1000) });

  // 5. Push tokens: a deleted account, a disabled one, a live one — plus a
  // collection-group match under the WRONG parent, which must never be attributed.
  await setDoc(doc(db, 'users', 'gone', 'fcmTokens', 't1'), { token: 'x' });
  await setDoc(doc(db, 'users', 'barred', 'fcmTokens', 't2'), { token: 'y' });
  await setDoc(doc(db, 'users', 'alive', 'fcmTokens', 't3'), { token: 'z' });
  await setDoc(doc(db, 'groups', 'g1', 'fcmTokens', 't9'), { token: 'not a user token' });

  // 6/7. Profiles that exist, and the username reservations pointing at uids.
  await setDoc(doc(db, 'users', 'alive'), { username: 'alivehandle' });
  await setDoc(doc(db, 'users', 'barred'), { username: 'barredhandle' });
  await setDoc(doc(db, 'usernames', 'alivehandle'), { uid: 'alive' });
  await setDoc(doc(db, 'usernames', 'barredhandle'), { uid: 'barred' });
  await setDoc(doc(db, 'usernames', 'gonehandle'), { uid: 'gone' });
  await setDoc(doc(db, 'usernames', 'strandedhandle'), { uid: 'stranded' });
  await setDoc(doc(db, 'usernames', 'suspendedhandle'), { uid: 'suspended' });
  await setDoc(doc(db, 'usernames', 'nouid'), { note: 'unattributable reservation' });
}

/**
 * The Auth side of the same fixture.
 *  - alive      — live, has a profile → untouched everywhere
 *  - barred     — DISABLED, has a profile → loses its push tokens, KEEPS its handle
 *  - stranded   — old, no profile → the aborted deletion this sweep finishes
 *  - freshling  — no profile but only an hour old → a signup mid-flight, spared
 *  - suspended  — DISABLED and no profile → moderation's shape; never reaped,
 *                 and its handle is never released
 *  - `gone`     — deliberately ABSENT from Auth entirely (its tokens are revoked
 *                 and its handle is released)
 */
const FULL_ACCOUNTS: FakeAccount[] = [
  { uid: 'alive', ageMs: 30 * 24 * 60 * 60 * 1000 },
  { uid: 'barred', ageMs: 30 * 24 * 60 * 60 * 1000, disabled: true },
  { uid: 'stranded', ageMs: ORPHAN_AUTH_MIN_AGE_MS + 1000 },
  { uid: 'freshling', ageMs: 60 * 60 * 1000 },
  { uid: 'suspended', ageMs: 30 * 24 * 60 * 60 * 1000, disabled: true },
];

describe('retentionCleanup orchestrator — all seven sweeps in one run (BIN-727 #27 condition 1)', () => {
  it('reaps exactly what is past its threshold and leaves every live neighbour alone', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(FULL_ACCOUNTS);
    await seedEverything(db);

    const summary = await runRetentionCleanup(makeIo(db, auth));

    // ── Sessions: expired + legacy-old go, tree and all.
    expect(summary.expiredSessions).toBe(2);
    expect(summary.deletedSessions).toBe(2);
    expect(await exists(db, 'sessions/expired')).toBe(false);
    expect(await exists(db, 'sessions/expired/participants/p1')).toBe(false);
    expect(await exists(db, 'sessions/expired/swipes/s1')).toBe(false);
    expect(await exists(db, 'sessions/legacy-old')).toBe(false);
    expect(await exists(db, 'sessions/live')).toBe(true);
    // Never delete data we cannot date.
    expect(await exists(db, 'sessions/undateable')).toBe(true);

    // ── Notifications: the one ON the threshold survives (#27 condition 2).
    expect(summary.deletedNotifications).toBe(1);
    expect(await exists(db, 'users/alive/notifications/old')).toBe(false);
    expect(await exists(db, 'users/alive/notifications/onthreshold')).toBe(true);

    // ── joinAttempts: the spent token is erased, the in-flight join is not.
    expect(summary.deletedJoinAttempts).toBe(1);
    expect(await exists(db, 'groups/g1/joinAttempts/gone')).toBe(false);
    expect(await exists(db, 'groups/g1/joinAttempts/inflight')).toBe(true);

    // ── Release markers: read from `updatedAt`. If this ever reads `createdAt`
    // the sole Art. 17 erasure path for these markers silently stops.
    expect(summary.deletedReleaseMarkers).toBe(1);
    expect(await exists(db, 'releaseNotifyState/550/notified/alive')).toBe(false);
    expect(await exists(db, 'releaseNotifyState/551/notified/alive')).toBe(true);

    // ── Push tokens (BIN-848): deleted AND disabled accounts lose them; the live
    // one keeps its, and the mis-parented collection-group match is never touched.
    expect(summary.revokedPushTokens).toBe(2);
    expect(summary.deletedRevokedTokens).toBe(2);
    expect(await exists(db, 'users/gone/fcmTokens/t1')).toBe(false);
    expect(await exists(db, 'users/barred/fcmTokens/t2')).toBe(false);
    expect(await exists(db, 'users/alive/fcmTokens/t3')).toBe(true);
    expect(await exists(db, 'groups/g1/fcmTokens/t9')).toBe(true);
    // A healthy run: everyone was asked about, nobody went unchecked. This pair is
    // what makes a zero readable (BIN-848's checkedUids).
    expect(summary.checkedUids).toBe(3);
    expect(summary.skippedAuthBatches).toBe(0);

    // ── Orphaned auth accounts (BIN-816): only the week-old profile-less one.
    expect(summary.checkedAuthAccounts).toBe(5);
    expect(summary.orphanAuthAccounts).toBe(1);
    expect(summary.deletedOrphanAuthAccounts).toBe(1);
    expect(summary.orphanAuthSkippedProfileBatches).toBe(0);
    expect(auth.deleted).toEqual(['stranded']);

    // ── Usernames (BIN-875): released only when BOTH the profile and the account
    // are confirmed gone — and `stranded` is released in the SAME run that
    // deleted its account, which is the only reason the two sweeps are ordered.
    // Six reservation docs were seeded; the one with no uid is not a reservation
    // this sweep can reason about at all, so it is not counted either.
    expect(summary.checkedReservations).toBe(5);
    expect(summary.orphanUsernames).toBe(2);
    expect(summary.deletedOrphanUsernames).toBe(2);
    expect(await exists(db, 'usernames/gonehandle')).toBe(false);
    expect(await exists(db, 'usernames/strandedhandle')).toBe(false);
    // A disabled account still exists and still owns its handle — the whole
    // reason absentUidsFromLookup is narrower than the push sweep's predicate.
    expect(await exists(db, 'usernames/barredhandle')).toBe(true);
    expect(await exists(db, 'usernames/suspendedhandle')).toBe(true);
    expect(await exists(db, 'usernames/alivehandle')).toBe(true);
    // Unattributable: no uid, so it can never be PROVEN orphaned.
    expect(await exists(db, 'usernames/nouid')).toBe(true);
  });

  it('a second run over the same data deletes nothing more (#27 condition 2)', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(FULL_ACCOUNTS);
    await seedEverything(db);

    await runRetentionCleanup(makeIo(db, auth));
    const second = await runRetentionCleanup(makeIo(db, auth));

    expect(second.deletedSessions).toBe(0);
    expect(second.deletedNotifications).toBe(0);
    expect(second.deletedJoinAttempts).toBe(0);
    expect(second.deletedReleaseMarkers).toBe(0);
    expect(second.deletedRevokedTokens).toBe(0);
    expect(second.deletedOrphanAuthAccounts).toBe(0);
    expect(second.deletedOrphanUsernames).toBe(0);
    // …and it is idempotent because there is nothing LEFT to find, not because
    // it stopped looking: it still checked every remaining account.
    expect(second.checkedAuthAccounts).toBe(4);
    expect(second.checkedUids).toBe(1);
    expect(auth.deleted).toEqual(['stranded']);
  });

  it('pages through a collection larger than one page, losing no document', async () => {
    const db = adminLikeDb();
    const auth = makeAuth([]);
    // 5 docs at pageSize 2 → three pages, the last one short. A cursor that fails
    // to advance loops forever; one that advances wrongly drops the tail.
    for (let i = 0; i < 5; i += 1) {
      await setDoc(doc(db, 'users', 'u1', 'notifications', `n${i}`), {
        createdAt: ts(NOW - NOTIFICATION_MAX_AGE_MS - 1000),
      });
    }

    const summary = await runRetentionCleanup(makeIo(db, auth));

    expect(summary.staleNotifications).toBe(5);
    expect(summary.deletedNotifications).toBe(5);
    const left = await getDocs(collectionGroup(db, 'notifications'));
    expect(left.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The ceiling, driven at its decisive boundary INSIDE the orchestrator
// (#27 condition 2, 2026-08-13 — the BIN-816 ratchet shape)
// ─────────────────────────────────────────────────────────────────────────────

/** `count` profile-less accounts old enough to reap, plus `live` healthy ones. */
async function seedOrphanAuth(db: Firestore, orphans: number, healthy: number): Promise<FakeAccount[]> {
  const accounts: FakeAccount[] = [];
  for (let i = 0; i < orphans; i += 1) {
    accounts.push({ uid: `orphan${i}`, ageMs: ORPHAN_AUTH_MIN_AGE_MS + 1000 });
  }
  for (let i = 0; i < healthy; i += 1) {
    accounts.push({ uid: `healthy${i}`, ageMs: ORPHAN_AUTH_MIN_AGE_MS + 1000 });
    await setDoc(doc(db, 'users', `healthy${i}`), { username: `h${i}` });
  }
  return accounts;
}

describe('retentionCleanup orchestrator — the orphan ceiling at its decisive edge', () => {
  it('deletes when the FRACTION alone would refuse but the absolute floor allows', async () => {
    const db = adminLikeDb();
    // 3 orphans out of 6 accounts checked. A bare quarter-rule refuses (3 > 1.5);
    // the floor of 5 is the only reason anything is reaped. This is the exact
    // shape that wedged BIN-816's sweep permanently at this project's scale.
    const accounts = await seedOrphanAuth(db, 3, 3);
    expect(3).toBeGreaterThan(6 * ORPHAN_AUTH_MAX_FRACTION); // the fraction WOULD refuse
    expect(3).toBeLessThanOrEqual(ORPHAN_AUTH_MIN_CEILING);  // the floor is what permits it
    const auth = makeAuth(accounts);

    const summary = await runRetentionCleanup(makeIo(db, auth));

    expect(summary.checkedAuthAccounts).toBe(6);
    expect(summary.orphanAuthAccounts).toBe(3);
    expect(summary.deletedOrphanAuthAccounts).toBe(3);
    expect(auth.deleted.sort()).toEqual(['orphan0', 'orphan1', 'orphan2']);
  });

  it('refuses the whole batch when the FRACTION trips, even though the floor would allow it', async () => {
    const db = adminLikeDb();
    // 11 orphans out of 40 accounts: above the floor (5) AND above a quarter (10).
    // A candidate set this shape means the query is broken, not that the day was
    // busy — and an auth deletion is irreversible.
    const accounts = await seedOrphanAuth(db, 11, 29);
    expect(11).toBeGreaterThan(ORPHAN_AUTH_MIN_CEILING);          // the floor WOULD allow
    expect(11).toBeGreaterThan(40 * ORPHAN_AUTH_MAX_FRACTION);    // the fraction refuses
    const auth = makeAuth(accounts);

    const summary = await runRetentionCleanup(makeIo(db, auth));

    expect(summary.checkedAuthAccounts).toBe(40);
    // It still REPORTS the 11 — refusing to act is not refusing to say so.
    expect(summary.orphanAuthAccounts).toBe(11);
    expect(summary.deletedOrphanAuthAccounts).toBe(0);
    expect(auth.deleted).toEqual([]);
  });

  it('applies the same ceiling to released usernames, counted against RESERVATIONS', async () => {
    const db = adminLikeDb();
    // 11 orphaned reservations out of 12 — the auth side is irrelevant here, and
    // that independence is the point: a refused account deletion must not be what
    // stops a handful of handles from being handed to strangers.
    for (let i = 0; i < 11; i += 1) {
      await setDoc(doc(db, 'usernames', `orphanhandle${i}`), { uid: `ghost${i}` });
    }
    await setDoc(doc(db, 'usernames', 'realhandle'), { uid: 'real' });
    await setDoc(doc(db, 'users', 'real'), { username: 'realhandle' });
    const auth = makeAuth([{ uid: 'real', ageMs: 30 * 24 * 60 * 60 * 1000 }]);

    const summary = await runRetentionCleanup(makeIo(db, auth));

    expect(summary.checkedReservations).toBe(12);
    expect(summary.orphanUsernames).toBe(11);
    expect(summary.deletedOrphanUsernames).toBe(0);
    expect(await exists(db, 'usernames/orphanhandle0')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error isolation + the −1-vs-0 reporting (#27 condition 4, 2026-08-13)
// ─────────────────────────────────────────────────────────────────────────────

describe('retentionCleanup orchestrator — one broken category never takes the others down', () => {
  it('a thrown notifications scan leaves the other six sweeps completed', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(FULL_ACCOUNTS);
    await seedEverything(db);

    const io = makeIo(db, auth, {
      scanPage: async (kind, cursor, pageSize) => {
        if (kind === 'notifications') throw new Error('missing index');
        return makeIo(db, auth).scanPage(kind, cursor, pageSize);
      },
    });
    const summary = await runRetentionCleanup(io);

    // The broken one reports nothing and deleted nothing…
    expect(summary.staleNotifications).toBe(0);
    expect(summary.deletedNotifications).toBe(0);
    expect(await exists(db, 'users/alive/notifications/old')).toBe(true);
    // …while all six others finished their work.
    expect(summary.deletedSessions).toBe(2);
    expect(summary.deletedJoinAttempts).toBe(1);
    expect(summary.deletedReleaseMarkers).toBe(1);
    expect(summary.deletedRevokedTokens).toBe(2);
    expect(summary.deletedOrphanAuthAccounts).toBe(1);
    expect(summary.deletedOrphanUsernames).toBe(2);
  });

  it('a dead push-token scan reports -1, not a healthy-looking zero', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(FULL_ACCOUNTS);
    await seedEverything(db);

    const io = makeIo(db, auth, {
      scanPage: async (kind, cursor, pageSize) => {
        if (kind === 'fcmTokens') throw new Error('collection group query failed');
        return makeIo(db, auth).scanPage(kind, cursor, pageSize);
      },
    });
    const summary = await runRetentionCleanup(io);

    expect(summary.revokedPushTokens).toBe(0);
    // The distinction the whole logging discipline exists for: -1 = "nothing was
    // checked", 0 = "everyone was checked and nobody was revoked".
    expect(summary.skippedAuthBatches).toBe(-1);
    expect(summary.checkedUids).toBe(0);
    expect(await exists(db, 'users/gone/fcmTokens/t1')).toBe(true);
    // Unaffected neighbours, including the two Auth-dependent sweeps.
    expect(summary.deletedNotifications).toBe(1);
    expect(summary.deletedOrphanAuthAccounts).toBe(1);
  });

  it('a dead orphan-auth scan reports -1 and still lets the username sweep run', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(FULL_ACCOUNTS);
    await seedEverything(db);

    const io = makeIo(db, auth, {
      listAuthAccounts: async () => { throw new Error('IAM: caller lacks firebaseauth.users.list'); },
    });
    const summary = await runRetentionCleanup(io);

    expect(summary.checkedAuthAccounts).toBe(-1);
    expect(summary.orphanAuthSkippedProfileBatches).toBe(-1);
    expect(summary.orphanAuthAccounts).toBe(0);
    expect(summary.deletedOrphanAuthAccounts).toBe(0);
    expect(auth.deleted).toEqual([]);
    // The username sweep is independent: `gone` is still absent from Auth, so its
    // handle is released. `stranded` keeps its handle — its account survived.
    expect(summary.deletedOrphanUsernames).toBe(1);
    expect(await exists(db, 'usernames/gonehandle')).toBe(false);
    expect(await exists(db, 'usernames/strandedhandle')).toBe(true);
  });

  it('an Auth lookup that throws deletes NOTHING it could not verify', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(FULL_ACCOUNTS);
    await seedEverything(db);

    const io = makeIo(db, auth, {
      lookupUsers: async () => { throw new Error('auth outage'); },
    });
    const summary = await runRetentionCleanup(io);

    // Push sweep: the batch is skipped and COUNTED — "could not verify" is not
    // "gone", and this is the one sweep whose false positive breaks a live device.
    expect(summary.skippedAuthBatches).toBe(1);
    expect(summary.checkedUids).toBe(3);
    expect(summary.revokedPushTokens).toBe(0);
    expect(await exists(db, 'users/gone/fcmTokens/t1')).toBe(true);
    // Username sweep: same rule, its own counter, and no handle released.
    expect(summary.orphanUsernameSkippedAuthBatches).toBe(1);
    expect(summary.deletedOrphanUsernames).toBe(0);
    expect(await exists(db, 'usernames/gonehandle')).toBe(true);
    // The auth-account sweep does not use getUsers at all, so it still completes.
    expect(summary.deletedOrphanAuthAccounts).toBe(1);
  });

  it('a profile lookup that throws deletes no account — absence was never confirmed', async () => {
    const db = adminLikeDb();
    const accounts = await seedOrphanAuth(db, 2, 1);
    const auth = makeAuth(accounts);

    const io = makeIo(db, auth, {
      profilesExist: async () => { throw new Error('getAll failed'); },
    });
    const summary = await runRetentionCleanup(io);

    expect(summary.checkedAuthAccounts).toBe(3);
    expect(summary.orphanAuthSkippedProfileBatches).toBeGreaterThan(0);
    expect(summary.orphanAuthAccounts).toBe(0);
    expect(summary.deletedOrphanAuthAccounts).toBe(0);
    expect(auth.deleted).toEqual([]);
  });

  it('a failed delete commit skips only its own chunk and is not counted as deleted', async () => {
    const db = adminLikeDb();
    const auth = makeAuth([]);
    // 3 stale notifications at deleteBatchSize 2 → chunks of 2 and 1.
    for (const id of ['n0', 'n1', 'n2']) {
      await setDoc(doc(db, 'users', 'u1', 'notifications', id), {
        createdAt: ts(NOW - NOTIFICATION_MAX_AGE_MS - 1000),
      });
    }
    const real = makeIo(db, auth);
    let commits = 0;
    const io = makeIo(db, auth, {
      deleteDocs: async (paths) => {
        commits += 1;
        if (commits === 1) throw new Error('commit rejected');
        await real.deleteDocs(paths);
      },
    });

    const summary = await runRetentionCleanup(io);

    expect(summary.staleNotifications).toBe(3);
    // Only the surviving chunk counts — the failed one is left for tomorrow.
    expect(summary.deletedNotifications).toBe(1);
    const left = await getDocs(collectionGroup(db, 'notifications'));
    expect(left.size).toBe(2);
  });
});
