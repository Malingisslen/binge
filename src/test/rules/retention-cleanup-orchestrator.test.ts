import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, collectionGroup, deleteDoc, doc, documentId, getDoc, getDocs,
  limit, orderBy, query, setDoc, startAfter, updateDoc, where, arrayRemove,
  deleteField, serverTimestamp, Timestamp, writeBatch,
  type Firestore, type Query,
} from 'firebase/firestore';

import { runGroupHandover, type HandoverIo } from '../../../functions/src/groupHandover/runHandover';
import { isEmptyExcept } from '../../../functions/src/groupHandover/logic';
import {
  FIELD_OWNED_CATEGORIES,
  FIELD_OWNED_MAX_DOCS_PER_UID,
} from '../../../functions/src/retentionCleanup/fieldOwned';

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
  ORPHAN_DATA_MIN_OBSERVED_MS,
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
  orphanWatch: { group: false, id: 'orphanWatch' },
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

    // BIN-1023. The Admin port uses listDocuments(), which also returns a uid
    // whose users/{uid} DOC is gone but whose subcollections survive. The client
    // SDK cannot do that, so this harness sees only uids with a real document —
    // a strict SUBSET of production's view. The ghost case is therefore driven
    // by overriding this method in the ghost test below, never assumed.
    //
    // Unpaged, matching the port's own contract: listDocuments() has no cursor,
    // so there is no pagination here for the harness to diverge from.
    listUserUids: async () => {
      const snap = await getDocs(query(collection(db, 'users'), orderBy(documentId())));
      return snap.docs.map((d) => d.id);
    },

    // No recursiveDelete on the client SDK either; reap the subcollections these
    // fixtures actually use, then the document, exactly as the Admin call does.
    deleteUserTree: async (uid) => {
      for (const sub of ['watchlist', 'episodeProgress', 'notifications', 'fcmTokens']) {
        const kids = await getDocs(collection(db, `users/${uid}/${sub}`));
        for (const k of kids.docs) await deleteDoc(k.ref);
      }
      await deleteDoc(doc(db, 'users', uid));
    },

    stampOrphanWatch: async (uids, nowMs) => {
      if (uids.length > TEST_DELETE_BATCH) throw new Error(`stamp chunk too large: ${uids.length}`);
      const batch = writeBatch(db);
      for (const uid of uids) batch.set(doc(db, 'orphanWatch', uid), { firstSeenAt: nowMs });
      await batch.commit();
    },

    // BIN-1063 steg 3 — the field-owned half. One query per category, mirroring
    // the Admin port. `groups` is not asked for here; the handover owns it.
    findFieldOwned: async (category, uid) => {
      const pathsOf = async (q: Query) => (await getDocs(q)).docs.map((d) => d.ref.path);
      switch (category) {
        case 'reviews': {
          const own = await getDocs(query(collection(db, 'reviews'), where('uid', '==', uid)));
          const nested: string[] = [];
          for (const d of own.docs) {
            for (const sub of ['likes', 'comments']) {
              nested.push(...(await getDocs(collection(d.ref, sub))).docs.map((x) => x.ref.path));
            }
          }
          return { deletePaths: [...nested, ...own.docs.map((d) => d.ref.path)], arrayStrips: [] };
        }
        case 'foreignReviewUgc':
          return {
            deletePaths: [
              ...await pathsOf(query(collectionGroup(db, 'likes'), where('uid', '==', uid))),
              ...await pathsOf(query(collectionGroup(db, 'comments'), where('uid', '==', uid))),
            ],
            arrayStrips: [],
          };
        case 'reactions':
          return {
            deletePaths: await pathsOf(query(collectionGroup(db, 'reactions'), where('uid', '==', uid))),
            arrayStrips: [],
          };
        case 'lists': {
          const edited = await getDocs(query(collection(db, 'lists'), where('editors', 'array-contains', uid)));
          return {
            deletePaths: await pathsOf(query(collection(db, 'lists'), where('uid', '==', uid))),
            arrayStrips: edited.docs
              .filter((d) => d.data().uid !== uid)
              .map((d) => ({ path: d.ref.path, field: 'editors' })),
          };
        }
        case 'sessions': {
          const hosted = await getDocs(query(collection(db, 'sessions'), where('hostUid', '==', uid)));
          const nested: string[] = [];
          for (const d of hosted.docs) {
            for (const sub of ['participants', 'swipes']) {
              nested.push(...(await getDocs(collection(d.ref, sub))).docs.map((x) => x.ref.path));
            }
          }
          return { deletePaths: [...nested, ...hosted.docs.map((d) => d.ref.path)], arrayStrips: [] };
        }
        case 'groups':
          return { deletePaths: [], arrayStrips: [] };
      }
    },

    stripFromArray: async (path, field, uid) => {
      await updateDoc(doc(db, path), { [field]: arrayRemove(uid) });
    },

    // Split READ from WRITE, so the document budget sees the handover's cost
    // before anything moves. Drives the SAME `runGroupHandover` both production
    // doors drive — no second election here.
    planGroupHandover: async (uid) => {
      const owned = await getDocs(query(collection(db, 'groups'), where('ownerUid', '==', uid)));
      const toDelete: string[] = [];
      let handoverDocs = 0;
      for (const g of owned.docs) {
        const memberUids = (g.data().memberUids as string[] | undefined) ?? [];
        const paths = await groupSubtreePaths(db, g.ref);
        if (isEmptyExcept(memberUids, uid)) {
          toDelete.push(...paths, g.ref.path);
          continue;
        }
        handoverDocs += 1 + paths.filter((path) => path.endsWith('/' + uid)).length;
      }
      return { toDelete, handoverDocs };
    },

    commitGroupHandover: async (uid) => {
      const summary = await runGroupHandover(handoverIo(db), uid);
      return { failed: summary.failed, toDeleteIds: summary.toDeleteIds, attempted: summary.attempted };
    },

    isStillEmptyGroup: async (groupId, uid) => {
      const snap = await getDoc(doc(db, 'groups', groupId));
      if (!snap.exists()) return false;
      const memberUids = (snap.data().memberUids as string[] | undefined) ?? [];
      return isEmptyExcept(memberUids, uid);
    },

    ...overrides,
  };
}

/**
 * The handover port, client-SDK. Deliberately a second implementation of the
 * PORT and not of the decision: `runGroupHandover` is the same function both
 * production doors drive, so no election is re-derived here.
 */
function handoverIo(db: Firestore): HandoverIo {
  return {
    log: { info: () => {}, error: () => {} },
    ownedGroupIds: async (uid) =>
      (await getDocs(query(collection(db, 'groups'), where('ownerUid', '==', uid)))).docs.map((d) => d.id),
    readGroup: async (groupId) => {
      const snap = await getDoc(doc(db, 'groups', groupId));
      if (!snap.exists()) return null;
      return {
        ownerUid: (snap.data().ownerUid as string | undefined) ?? '',
        memberUids: (snap.data().memberUids as string[] | undefined) ?? [],
      };
    },
    readMembers: async (groupId) =>
      (await getDocs(collection(db, 'groups', groupId, 'members'))).docs.map((x) => {
        const raw = x.data().joinedAt;
        return { uid: x.id, joinedAtMs: raw instanceof Timestamp ? raw.toMillis() : null };
      }),
    readWatchlist: async (groupId) =>
      (await getDocs(collection(db, 'groups', groupId, 'watchlist'))).docs
        .map((x) => ({ id: x.id, addedBy: x.data().addedBy })),
    readSessionHistory: async (groupId) =>
      (await getDocs(collection(db, 'groups', groupId, 'sessionHistory'))).docs.map((x) => ({
        id: x.id,
        pickedByUid: x.data().pickedByUid,
        participantUids: (x.data().participantUids as string[] | undefined) ?? [],
      })),
    claimOwnership: async (groupId, expectedOwnerUid, write) => {
      const ref = doc(db, 'groups', groupId);
      const fresh = await getDoc(ref);
      if (!fresh.exists() || fresh.data().ownerUid !== expectedOwnerUid) return false;
      await updateDoc(ref, {
        ownerUid: write.ownerUid,
        memberUids: write.memberUids,
        updatedAt: serverTimestamp(),
      });
      return true;
    },
    eraseMemberTraces: async (groupId, leavingUid, erasure) => {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'groups', groupId, 'members', leavingUid));
      batch.delete(doc(db, 'groups', groupId, 'household', leavingUid));
      batch.delete(doc(db, 'groups', groupId, 'joinAttempts', leavingUid));
      for (const itemId of erasure.itemIds) {
        batch.delete(doc(db, 'groups', groupId, 'watchlist', itemId, 'progress', leavingUid));
      }
      for (const itemId of erasure.clearAddedByIds) {
        batch.update(doc(db, 'groups', groupId, 'watchlist', itemId), { addedBy: deleteField() });
      }
      for (const rowId of erasure.clearPickedByIds) {
        batch.update(doc(db, 'groups', groupId, 'sessionHistory', rowId), { pickedByUid: deleteField() });
      }
      for (const rowId of erasure.dropParticipantIds) {
        batch.update(doc(db, 'groups', groupId, 'sessionHistory', rowId), {
          participantUids: arrayRemove(leavingUid),
        });
      }
      await batch.commit();
    },
  };
}

/** Every document under one group, excluding the group document itself. */
async function groupSubtreePaths(
  db: Firestore,
  groupRef: ReturnType<typeof doc>,
): Promise<string[]> {
  const paths: string[] = [];
  for (const sub of ['members', 'household', 'sessionHistory', 'joinAttempts']) {
    paths.push(...(await getDocs(collection(groupRef, sub))).docs.map((d) => d.ref.path));
  }
  const items = await getDocs(collection(groupRef, 'watchlist'));
  for (const item of items.docs) {
    paths.push(...(await getDocs(collection(item.ref, 'progress'))).docs.map((d) => d.ref.path));
  }
  paths.push(...items.docs.map((d) => d.ref.path));
  return paths;
}

async function exists(db: Firestore, path: string): Promise<boolean> {
  return (await getDoc(doc(db, path))).exists();
}

// ─────────────────────────────────────────────────────────────────────────────
// The full fixture for the sweeps this describe block drives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One database containing, for the sweeps this fixture drives, something each
 * MUST reap and something each MUST leave alone. The BIN-1023 orphan-data sweep
 * is NOT among them — it has its own describe block with its own fixture.
 * #27's condition 1: a test that
 * drives only the four
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

describe('retentionCleanup orchestrator — the sweeps this fixture seeds, in one run (BIN-727 #27 condition 1)', () => {
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
  it('a thrown notifications scan leaves every other sweep in this fixture completed', async () => {
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
    // …while the others this fixture seeds finished their work.
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

/**
 * BIN-1023 — the inverse orphan: Firestore data whose owner has no Auth account.
 *
 * Driven as a CONSOLE deletion, which is the shape that actually produces this
 * state. The ticket blamed an interrupted client cascade; `collectDeletionRefs`
 * queues the watchlist in section 1 and `users/{uid}` in section 9 and commits
 * the chunks in order, so a confirmed-missing profile almost always means the
 * library went with it. Deleting the Auth user from the Console runs no cascade
 * at all, and leaves every document in place.
 */
const ORPHAN_DATA_ACCOUNTS: FakeAccount[] = [
  { uid: 'keeper', ageMs: 30 * 24 * 60 * 60 * 1000 },
  { uid: 'banned', ageMs: 30 * 24 * 60 * 60 * 1000, disabled: true },
];

/** Every uid has an Auth account — used to drive the watch-record reset. */
const ALL_PRESENT_ACCOUNTS: FakeAccount[] = [
  ...ORPHAN_DATA_ACCOUNTS,
  { uid: 'consoled', ageMs: 30 * 24 * 60 * 60 * 1000 },
];

/** `consoled` owns data but no Auth account; `keeper` and `banned` do have one. */
async function seedOrphanData(db: Firestore): Promise<void> {
  for (const uid of ['consoled', 'keeper', 'banned']) {
    await setDoc(doc(db, 'users', uid), { username: uid + 'handle' });
    await setDoc(doc(db, 'users', uid, 'watchlist', 'movie_42'), { tmdbId: 42 });
    // A SIBLING subcollection: the ticket asked only for watchlist, and the
    // panel's whole objection was that erasing that alone leaves the rest
    // orphaned under the same dead uid. This doc is what pins the wider scope.
    await setDoc(doc(db, 'users', uid, 'episodeProgress', 'tv_1399'), { season: 1 });
    await setDoc(doc(db, 'publicProfiles', uid), { displayName: uid });
  }
}

/**
 * BIN-1063 steg 3 — the FIELD-owned half, seeded for `consoled` (absent from
 * Auth) AND for `keeper` (live).
 *
 * The live sibling in every category is the point. A test that only checks the
 * target is gone cannot tell "filtered by uid" from "wiped the collection", and
 * the sweep runs on the Admin SDK where no rule would stop the second.
 */
async function seedFieldOwned(db: Firestore): Promise<void> {
  for (const uid of ['consoled', 'keeper']) {
    await setDoc(doc(db, 'reviews', `rev-${uid}`), { uid, text: 'min recension' });
    await setDoc(doc(db, 'reviews', `rev-${uid}`, 'likes', 'someone'), { uid: 'someone' });
    await setDoc(doc(db, 'reviews', `rev-${uid}`, 'comments', 'c1'), { uid: 'someone' });
    // UGC on SOMEBODY ELSE'S review: owned by the field, not by the path.
    await setDoc(doc(db, 'reviews', 'rev-stranger', 'likes', uid), { uid });
    await setDoc(doc(db, 'reviews', 'rev-stranger', 'comments', `c-${uid}`), { uid });
    await setDoc(doc(db, 'episodeReactions', 'tv_1399_1_2', 'reactions', `r-${uid}`), { uid });
    await setDoc(doc(db, 'lists', `list-${uid}`), { uid, editors: [uid] });
    await setDoc(doc(db, 'sessions', `sess-${uid}`), { hostUid: uid });
    await setDoc(doc(db, 'sessions', `sess-${uid}`, 'participants', uid), { uid });
    await setDoc(doc(db, 'sessions', `sess-${uid}`, 'swipes', 'movie_42'), { votes: {} });
  }
  await setDoc(doc(db, 'reviews', 'rev-stranger'), { uid: 'stranger', text: 'annans' });
  // A list a stranger OWNS and the departing account merely co-edits. Deleting it
  // would destroy a third party's data over somebody else's erasure.
  await setDoc(doc(db, 'lists', 'coedited'), { uid: 'stranger', editors: ['stranger', 'consoled'] });
  // A group with a remaining member: HANDED OVER, never deleted (Malin,
  // 2026-09-06). And one with nobody left, which is this sweep's to delete.
  await setDoc(doc(db, 'groups', 'shared'), { ownerUid: 'consoled', memberUids: ['consoled', 'keeper'] });
  await setDoc(doc(db, 'groups', 'shared', 'members', 'consoled'), { uid: 'consoled', joinedAt: ts(NOW - 2000) });
  await setDoc(doc(db, 'groups', 'shared', 'members', 'keeper'), { uid: 'keeper', joinedAt: ts(NOW - 1000) });
  await setDoc(doc(db, 'groups', 'shared', 'watchlist', 'movie_7'), { addedBy: 'consoled' });
  await setDoc(doc(db, 'groups', 'solo'), { ownerUid: 'consoled', memberUids: ['consoled'] });
  await setDoc(doc(db, 'groups', 'solo', 'members', 'consoled'), { uid: 'consoled', joinedAt: ts(NOW - 2000) });
}

const ONE_DAY = 24 * 60 * 60 * 1000;

describe('retentionCleanup orchestrator — the FIELD-owned half (BIN-1063 steg 3)', () => {
  /** Run twice: the first observes, the second erases once the floor has elapsed. */
  async function sweepPastTheFloor(db: Firestore) {
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);
    await seedFieldOwned(db);
    await runRetentionCleanup(makeIo(db, auth));
    const later = NOW + ORPHAN_DATA_MIN_OBSERVED_MS + ONE_DAY;
    return runRetentionCleanup(makeIo(db, auth, { now: () => later }));
  }

  // Each row asserts the departed account's document is gone AND the live
  // account's sibling in the SAME collection is untouched. That pair is what
  // separates "filtered by uid" from "wiped the collection" — and the sweep runs
  // on the Admin SDK, where no rule would stop the second.
  it.each([
    ['reviews', 'reviews/rev-consoled', 'reviews/rev-keeper'],
    ['a review own likes', 'reviews/rev-consoled/likes/someone', 'reviews/rev-keeper/likes/someone'],
    ['likes on a stranger review', 'reviews/rev-stranger/likes/consoled', 'reviews/rev-stranger/likes/keeper'],
    ['comments on a stranger review', 'reviews/rev-stranger/comments/c-consoled', 'reviews/rev-stranger/comments/c-keeper'],
    ['episode reactions', 'episodeReactions/tv_1399_1_2/reactions/r-consoled', 'episodeReactions/tv_1399_1_2/reactions/r-keeper'],
    ['owned lists', 'lists/list-consoled', 'lists/list-keeper'],
    ['hosted sessions', 'sessions/sess-consoled', 'sessions/sess-keeper'],
    ['session participants', 'sessions/sess-consoled/participants/consoled', 'sessions/sess-keeper/participants/keeper'],
  ])('erases %s for the departed account and leaves the live one alone', async (_label, gone, kept) => {
    const db = adminLikeDb();
    await sweepPastTheFloor(db);

    expect(await exists(db, gone), gone + ' should be erased').toBe(false);
    expect(await exists(db, kept), kept + ' belongs to a LIVE account').toBe(true);
  });

  // A roster requirement OUTSIDE the table: the rows above are hand-written, so
  // a category added to the run with no row here would be invisible. This ties
  // the set to the exported list the run actually walks. `groups` has its own
  // two cases below — handover and delete are different outcomes and one row
  // could not express both.
  it('the table is checked against the list the run walks', () => {
    expect([...FIELD_OWNED_CATEGORIES]).toEqual([
      'reviews', 'foreignReviewUgc', 'reactions', 'lists', 'sessions', 'groups',
    ]);
  });

  it('strips the departed uid from a list a stranger owns, and keeps the list', async () => {
    const db = adminLikeDb();
    await sweepPastTheFloor(db);

    const coedited = await getDoc(doc(db, 'lists', 'coedited'));
    expect(coedited.exists(), 'a third party list must survive').toBe(true);
    expect(coedited.data()?.editors).toEqual(['stranger']);
  });

  it('hands over a group with a remaining member instead of deleting it', async () => {
    const db = adminLikeDb();
    await sweepPastTheFloor(db);

    const shared = await getDoc(doc(db, 'groups', 'shared'));
    expect(shared.exists(), 'the group must survive for the member still in it').toBe(true);
    expect(shared.data()?.ownerUid).toBe('keeper');
    expect(await exists(db, 'groups/shared/members/consoled')).toBe(false);
    expect(await exists(db, 'groups/shared/members/keeper')).toBe(true);
    // The shared list survives; only the note about who added it goes.
    const item = await getDoc(doc(db, 'groups', 'shared', 'watchlist', 'movie_7'));
    expect(item.exists()).toBe(true);
    expect('addedBy' in (item.data() ?? {})).toBe(false);
  });

  it('deletes a group with nobody left, because a successor cannot be invented', async () => {
    const db = adminLikeDb();
    await sweepPastTheFloor(db);

    expect(await exists(db, 'groups/solo')).toBe(false);
    expect(await exists(db, 'groups/solo/members/consoled')).toBe(false);
  });

  // The re-verify, driven for real: `solo` is empty when the plan is made, and
  // somebody joins before the write. Without the re-check this run would delete
  // a LIVE third party's group — the worst outcome available to the sweep, and
  // the only one nothing else guards.
  it('spares a group that gained a member between the plan and the write', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);
    await seedFieldOwned(db);
    await runRetentionCleanup(makeIo(db, auth));
    const later = NOW + ORPHAN_DATA_MIN_OBSERVED_MS + ONE_DAY;

    // The join lands in the real window: after the plan read the group, before
    // the write phase asks whether it is still empty.
    const io = makeIo(db, auth, { now: () => later });
    const summary = await runRetentionCleanup({
      ...io,
      commitGroupHandover: async (uid) => {
        await setDoc(doc(db, 'groups', 'solo'), { ownerUid: 'consoled', memberUids: ['consoled', 'latecomer'] });
        await setDoc(doc(db, 'groups', 'solo', 'members', 'latecomer'), { uid: 'latecomer', joinedAt: ts(later) });
        return io.commitGroupHandover(uid);
      },
    });

    // Not refused — the run finishes; it just leaves that one group standing.
    expect(summary.fieldOwnedRefused).toBe(0);
    expect(await exists(db, 'groups/solo')).toBe(true);
    expect(await exists(db, 'groups/solo/members/latecomer')).toBe(true);
  });

  it('counts what it did, so a zero cannot mean three things', async () => {
    const db = adminLikeDb();
    const summary = await sweepPastTheFloor(db);

    expect(summary.fieldOwnedUids).toBe(1);
    expect(summary.fieldOwnedDocs).toBeGreaterThan(0);
    expect(summary.fieldOwnedRefused).toBe(0);
  });

  // The account-level ceiling counts PEOPLE. This budget counts DOCUMENTS, which
  // is the blast radius of a CORRECT pick — one account can own thousands of
  // reactions. All-or-nothing per uid: a partial erasure driven by a budget would
  // leave an arbitrary half standing with no record of which half.
  it('refuses the whole uid when the document budget is exceeded, and keeps the watch record', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);
    await seedFieldOwned(db);
    await runRetentionCleanup(makeIo(db, auth));
    const later = NOW + ORPHAN_DATA_MIN_OBSERVED_MS + ONE_DAY;

    const summary = await runRetentionCleanup(makeIo(db, auth, {
      now: () => later,
      findFieldOwned: async () => ({
        deletePaths: Array.from({ length: FIELD_OWNED_MAX_DOCS_PER_UID + 1 }, (_, i) => 'reviews/x' + i),
        arrayStrips: [],
      }),
    }));

    expect(summary.fieldOwnedRefused).toBe(1);
    expect(summary.erasedOrphanDataUids).toBe(0);
    // Nothing was erased, in EITHER half — and the watch record survives, so the
    // next run retries rather than restarting the observation clock.
    expect(await exists(db, 'reviews/rev-consoled')).toBe(true);
    expect(await exists(db, 'users/consoled')).toBe(true);
    expect(await exists(db, 'orphanWatch/consoled')).toBe(true);
  });

  // The erasure is all-or-nothing per uid, so a failed chunk must THROW here.
  // `deleteInBatches` — right for the TTL sweeps, which leave the residue for
  // tomorrow — would swallow it and let this run go on to delete `users/{uid}`
  // and the watch record, after which the uid never appears in `listUserUids()`
  // again and the surviving documents are unreachable by any later run.
  it('aborts the whole uid when a delete chunk fails, rather than swallowing it', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);
    await seedFieldOwned(db);
    await runRetentionCleanup(makeIo(db, auth));
    const later = NOW + ORPHAN_DATA_MIN_OBSERVED_MS + ONE_DAY;

    // `reviews` is FIRST in the category order, so this fires before anything
    // else has been written.
    const base = makeIo(db, auth, { now: () => later });
    const summary = await runRetentionCleanup({
      ...base,
      deleteDocs: async (paths) => {
        if (paths.some((path) => path.startsWith('reviews/rev-consoled'))) {
          throw new Error('chunk commit failed');
        }
        return base.deleteDocs(paths);
      },
    });

    // An IO failure, not a decision this run made — so NOT counted as refused.
    expect(summary.fieldOwnedRefused).toBe(0);
    expect(summary.erasedOrphanDataUids).toBe(0);
    // The uid stays on the books: private half untouched, watch record alive,
    // so the next run picks it up again.
    expect(await exists(db, 'users/consoled')).toBe(true);
    expect(await exists(db, 'orphanWatch/consoled')).toBe(true);
  });

  // A LATER chunk can fail after an earlier one committed. A count returned only
  // on the normal path is lost to the throw, and the run reports zero documents
  // for an erasure that deleted some — the ambiguity the whole counter exists to
  // remove.
  it('counts the chunks that landed before a later chunk failed', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);
    await seedFieldOwned(db);
    await runRetentionCleanup(makeIo(db, auth));
    const later = NOW + ORPHAN_DATA_MIN_OBSERVED_MS + ONE_DAY;

    await setDoc(doc(db, 'reviews', 'chunk-a'), { uid: 'consoled' });
    await setDoc(doc(db, 'reviews', 'chunk-b'), { uid: 'consoled' });
    const base = makeIo(db, auth, { now: () => later, deleteBatchSize: 1 });
    let seen = 0;
    const summary = await runRetentionCleanup({
      ...base,
      // One document per chunk, so the second call is a chunk that follows a
      // COMMITTED one — not the first-chunk case the sibling test drives.
      findFieldOwned: async (category) =>
        category === 'reviews'
          ? { deletePaths: ['reviews/chunk-a', 'reviews/chunk-b'], arrayStrips: [] }
          : { deletePaths: [], arrayStrips: [] },
      deleteDocs: async (paths) => {
        if (paths[0]?.startsWith('reviews/chunk-')) {
          seen += 1;
          if (seen === 2) throw new Error('second chunk failed');
          return base.deleteDocs(paths);
        }
        return base.deleteDocs(paths);
      },
    });

    // One landed, one did not. Neither 0 nor 2.
    expect(summary.fieldOwnedDocs).toBe(1);
    expect(await exists(db, 'reviews/chunk-a')).toBe(false);
    expect(await exists(db, 'reviews/chunk-b')).toBe(true);
    expect(await exists(db, 'users/consoled')).toBe(true);
    expect(await exists(db, 'orphanWatch/consoled')).toBe(true);
  });

  // Groups are LAST in the order, so by the time a handover fails the earlier
  // categories are already written. The property that holds is not "nothing was
  // erased" — it is that the uid stays ON THE BOOKS: the private half is not
  // touched, the watch record survives, and every write is idempotent, so the
  // retry converges instead of stranding what is left.
  it('keeps the uid retryable when the group handover fails', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);
    await seedFieldOwned(db);
    await runRetentionCleanup(makeIo(db, auth));
    const later = NOW + ORPHAN_DATA_MIN_OBSERVED_MS + ONE_DAY;

    const summary = await runRetentionCleanup(makeIo(db, auth, {
      now: () => later,
      commitGroupHandover: async () => ({ failed: 1, toDeleteIds: [], attempted: 0 }),
    }));

    expect(summary.erasedOrphanDataUids).toBe(0);
    // The private half is untouched and the watch record survives, which is what
    // brings the uid back on the next run.
    expect(await exists(db, 'users/consoled')).toBe(true);
    expect(await exists(db, 'users/consoled/watchlist/movie_42')).toBe(true);
    expect(await exists(db, 'orphanWatch/consoled')).toBe(true);
    // And the group itself is untouched: the failure is reported before anything
    // under it is deleted.
    expect(await exists(db, 'groups/shared')).toBe(true);
    // But the earlier categories ARE gone, and the count says so. A zero here
    // would read exactly like a run that wrote nothing, which is the opposite
    // of what happened.
    expect(summary.fieldOwnedDocs).toBeGreaterThan(0);
    expect(await exists(db, 'reviews/rev-consoled')).toBe(false);
  });

  // The case no per-file gate can see: a uid whose ONLY field-owned content is
  // groups. The handover moves the first group's ownership, then fails on the
  // second. If the credit waited for the clean path the summary would say zero
  // — byte-identical to a run that wrote nothing, which is the one thing this
  // counter exists to tell apart.
  it('counts the groups a failed handover already wrote to', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);
    await seedFieldOwned(db);
    await runRetentionCleanup(makeIo(db, auth));
    const later = NOW + ORPHAN_DATA_MIN_OBSERVED_MS + ONE_DAY;

    const summary = await runRetentionCleanup(makeIo(db, auth, {
      now: () => later,
      // Every other category empty, so the group half is the only thing that
      // can appear in the count.
      findFieldOwned: async () => ({ deletePaths: [], arrayStrips: [] }),
      commitGroupHandover: async () => ({ failed: 1, toDeleteIds: [], attempted: 1 }),
    }));

    expect(summary.fieldOwnedRefused).toBe(1);
    expect(summary.erasedOrphanDataUids).toBe(0);
    // One group was written to before the failure. Not zero.
    expect(summary.fieldOwnedDocs).toBe(1);
    expect(await exists(db, 'users/consoled')).toBe(true);
    expect(await exists(db, 'orphanWatch/consoled')).toBe(true);
  });

  // The mirror of the re-verify. The plan snapshots which groups are empty; a
  // group that loses its last OTHER member after that is not in the plan, and
  // `runGroupHandover` deliberately deletes nothing. Without the stop it would
  // stand forever: this same run erases `users/{uid}` moments later, and the uid
  // never appears in `listUserUids()` again.
  it('stops when a group empties between the plan and the write', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);
    await seedFieldOwned(db);
    await runRetentionCleanup(makeIo(db, auth));
    const later = NOW + ORPHAN_DATA_MIN_OBSERVED_MS + ONE_DAY;

    // `shared` HAS a survivor at plan time, so it is not in `plan.toDelete`.
    // Commit time reports it as a delete: the survivor left in between.
    const summary = await runRetentionCleanup(makeIo(db, auth, {
      now: () => later,
      // Silence every other category, so the ONLY thing that could show up in
      // `fieldOwnedDocs` is the handover's estimate. A group that empties late
      // writes nothing — the `delete` outcome only records the id — so crediting
      // the estimate here would report writes that never happened.
      findFieldOwned: async () => ({ deletePaths: [], arrayStrips: [] }),
      commitGroupHandover: async () => ({ failed: 0, toDeleteIds: ['shared'], attempted: 0 }),
    }));

    expect(summary.fieldOwnedDocs).toBe(0);
    expect(summary.fieldOwnedRefused).toBe(1);
    expect(summary.erasedOrphanDataUids).toBe(0);
    // Untouched and retryable: the next run plans `shared` as empty from the
    // start, budgets it, and deletes it with the re-verify in place.
    expect(await exists(db, 'groups/shared')).toBe(true);
    expect(await exists(db, 'users/consoled')).toBe(true);
    expect(await exists(db, 'orphanWatch/consoled')).toBe(true);
  });

  // The negative side of the same check: an id the plan ALREADY carries is the
  // ordinary empty-group case and must not trip the stop.
  it('does not stop when the commit only repeats a group the plan already had', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);
    await seedFieldOwned(db);
    // `solo` is seeded with nobody but the departing owner, so it is empty at
    // PLAN time and the commit is only repeating what the plan already said.
    await runRetentionCleanup(makeIo(db, auth));
    const later = NOW + ORPHAN_DATA_MIN_OBSERVED_MS + ONE_DAY;

    const summary = await runRetentionCleanup(makeIo(db, auth, {
      now: () => later,
      commitGroupHandover: async () => ({ failed: 0, toDeleteIds: ['solo'], attempted: 0 }),
    }));

    expect(summary.fieldOwnedRefused).toBe(0);
    expect(await exists(db, 'groups/solo')).toBe(false);
  });
});

describe('retentionCleanup orchestrator — data whose owner is gone from Auth (BIN-1023)', () => {
  it('records a first observation and erases NOTHING on that run', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);

    const summary = await runRetentionCleanup(makeIo(db, auth));

    expect(summary.watchedOrphanDataUids).toBe(1);
    expect(summary.erasedOrphanDataUids).toBe(0);
    expect(await exists(db, 'users/consoled')).toBe(true);
    // The record the second run reads. Its value is what makes the floor a real
    // window rather than a number nobody measures against.
    expect(await exists(db, 'orphanWatch/consoled')).toBe(true);
  });

it('does not count a stamp that never committed', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);

    // The counter must report what was WRITTEN, not what was attempted. A run
    // whose stamps all fail — a denied write, a quota — would otherwise be
    // byte-identical in the summary to the healthy day after a Console
    // deletion, and §5d of the runbook tells the operator to wait out the
    // window on exactly that signature. That run never erases anything and
    // re-stamps forever, so the wait would never end.
    const summary = await runRetentionCleanup(
      makeIo(db, auth, {
        stampOrphanWatch: async () => { throw new Error('stamp commit failed'); },
      }),
    );

    expect(summary.watchedOrphanDataUids).toBe(0);
    expect(await exists(db, 'orphanWatch/consoled')).toBe(false);
    // The uid is still a candidate; nothing was erased on the strength of an
    // observation that was never recorded.
    expect(summary.erasedOrphanDataUids).toBe(0);
    expect(await exists(db, 'users/consoled')).toBe(true);
  });

  it('erases the WHOLE user tree and the public projection once the floor has elapsed', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);

    await runRetentionCleanup(makeIo(db, auth));
    const later = NOW + ORPHAN_DATA_MIN_OBSERVED_MS + ONE_DAY;
    const summary = await runRetentionCleanup(makeIo(db, auth, { now: () => later }));

    expect(summary.erasedOrphanDataUids).toBe(1);
    expect(await exists(db, 'users/consoled')).toBe(false);
    expect(await exists(db, 'users/consoled/watchlist/movie_42')).toBe(false);
    // #27's condition 2, the reason the scope was widened past the ticket: a
    // sibling subcollection must go too, or the sweep leaves a worse state than
    // it found — everything orphaned EXCEPT the one collection it cleaned.
    expect(await exists(db, 'users/consoled/episodeProgress/tv_1399')).toBe(false);
    // #6 DPO's condition: publicProfiles is world-readable and lives outside the
    // users/{uid} tree, so it must be erased in the same pass or it is
    // unreachable by any later run.
    expect(await exists(db, 'publicProfiles/consoled')).toBe(false);
    expect(await exists(db, 'orphanWatch/consoled')).toBe(false);
  });

  it('never touches a live account or a DISABLED one, however long it waits', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);

    await runRetentionCleanup(makeIo(db, auth));
    const later = NOW + ORPHAN_DATA_MIN_OBSERVED_MS + ONE_DAY;
    await runRetentionCleanup(makeIo(db, auth, { now: () => later }));

    expect(await exists(db, 'users/keeper/watchlist/movie_42')).toBe(true);
    // Moderation suspends by disabling the Auth user and leaving Firestore
    // alone. A disabled account EXISTS, so it is never absent — erasing its
    // library would quietly turn a suspension into a deletion.
    expect(await exists(db, 'users/banned/watchlist/movie_42')).toBe(true);
    expect(await exists(db, 'publicProfiles/banned')).toBe(true);
  });

  it('erases nothing when the Auth lookup FAILS — a dead check is not a licence', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);
    // Give it a record old enough that only the lookup stands between the data
    // and deletion; otherwise this test would pass for the wrong reason.
    await setDoc(doc(db, 'orphanWatch', 'consoled'), {
      firstSeenAt: NOW - ORPHAN_DATA_MIN_OBSERVED_MS - 1,
    });

    const summary = await runRetentionCleanup(
      makeIo(db, auth, {
        lookupUsers: async () => { throw new Error('auth outage'); },
      }),
    );

    expect(summary.erasedOrphanDataUids).toBe(0);
    expect(summary.orphanDataSkippedAuthBatches).toBeGreaterThan(0);
    expect(await exists(db, 'users/consoled')).toBe(true);
  });

  it('drops the watch record when the uid reads PRESENT again', async () => {
    const db = adminLikeDb();
    await seedOrphanData(db);
    await setDoc(doc(db, 'orphanWatch', 'keeper'), {
      firstSeenAt: NOW - ORPHAN_DATA_MIN_OBSERVED_MS - 1,
    });

    const summary = await runRetentionCleanup(makeIo(db, makeAuth(ALL_PRESENT_ACCOUNTS)));

    // An account that came back, or a lookup that was simply wrong once. Either
    // way the clock resets instead of ageing on toward deleting a live library.
    expect(summary.clearedOrphanDataWatches).toBe(1);
    expect(await exists(db, 'orphanWatch/keeper')).toBe(false);
    expect(await exists(db, 'users/keeper/watchlist/movie_42')).toBe(true);
  });

  it('refuses the whole run rather than erase an implausible share of the base', async () => {
    const db = adminLikeDb();
    // Nobody has an Auth account: the shape a wrong project id, or an Auth
    // outage answering notFound for everyone, produces. Every uid reads
    // orphaned, every record is old enough, and the ceiling is the only thing
    // left — the Admin SDK does not consult firestore.rules.
    //
    // EIGHT uids, not three, and the number is doing work. The shared ceiling
    // refuses at `candidates > max(ORPHAN_AUTH_MIN_CEILING, checked * FRACTION)`
    // — 8 > max(5, 2). Three of three would NOT refuse, because the absolute
    // floor of 5 deliberately lets a small project reap a realistic day's worth
    // (see the constant's own comment). That is the documented residual, not a
    // bug, and the sibling test below pins it so nobody "fixes" it into a latch.
    const auth = makeAuth([]);
    const uids = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'];
    for (const uid of uids) {
      await setDoc(doc(db, 'users', uid), { username: uid + 'handle' });
      await setDoc(doc(db, 'users', uid, 'watchlist', 'movie_42'), { tmdbId: 42 });
      await setDoc(doc(db, 'orphanWatch', uid), {
        firstSeenAt: NOW - ORPHAN_DATA_MIN_OBSERVED_MS - 1,
      });
    }

    const summary = await runRetentionCleanup(makeIo(db, auth));

    expect(summary.orphanDataUids).toBe(8);
    expect(summary.erasedOrphanDataUids).toBe(0);
    // Not the pruned set — a half-run looks like a successful one.
    for (const uid of uids) {
      expect(await exists(db, 'users/' + uid + '/watchlist/movie_42')).toBe(true);
    }
  });

  it('still erases a SMALL candidate set — the floor under the ceiling is deliberate', async () => {
    const db = adminLikeDb();
    // The other side of the constant above. Without the absolute floor of 5 a
    // bare fraction refuses even one orphan in a three-account project, and the
    // sweep latches shut forever: the candidate set only grows, and the
    // denominator only grows with new signups. Three of three must go through.
    const auth = makeAuth([]);
    await seedOrphanData(db);
    for (const uid of ['consoled', 'keeper', 'banned']) {
      await setDoc(doc(db, 'orphanWatch', uid), {
        firstSeenAt: NOW - ORPHAN_DATA_MIN_OBSERVED_MS - 1,
      });
    }

    const summary = await runRetentionCleanup(makeIo(db, auth));

    expect(summary.orphanDataUids).toBe(3);
    expect(summary.erasedOrphanDataUids).toBe(3);
  });


  it('deletes publicProfiles BEFORE the tree — proven by failing in between', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);
    await setDoc(doc(db, 'orphanWatch', 'consoled'), {
      firstSeenAt: NOW - ORPHAN_DATA_MIN_OBSERVED_MS - 1,
    });

    // The order is load-bearing, and only a failure BETWEEN the two deletes can
    // tell the two orders apart: with the tree gone first, the uid stops
    // appearing in `listUserUids`, so a publicProfiles doc left behind would be
    // world-readable and unreachable by every later run. Reversing the two
    // statements passes every other test in this file.
    const summary = await runRetentionCleanup(
      makeIo(db, auth, {
        deleteUserTree: async () => { throw new Error('recursiveDelete failed'); },
      }),
    );

    // Already gone — so it was deleted first, before the failure.
    expect(await exists(db, 'publicProfiles/consoled')).toBe(false);
    // The tree survives, and the run does not claim an erasure it did not make.
    expect(await exists(db, 'users/consoled/watchlist/movie_42')).toBe(true);
    expect(summary.erasedOrphanDataUids).toBe(0);
    // The watch record is KEPT with its original stamp, so the next run retries
    // at once instead of restarting the three-day clock.
    expect(await exists(db, 'orphanWatch/consoled')).toBe(true);
  });

  it('leaves the tree alone when the public projection cannot be deleted', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);
    await setDoc(doc(db, 'orphanWatch', 'consoled'), {
      firstSeenAt: NOW - ORPHAN_DATA_MIN_OBSERVED_MS - 1,
    });

    // The mirror of the test above. The first delete failing must abort the
    // whole erase rather than press on: a deleted tree with a surviving public
    // projection is the one half-done state that cannot be recovered from.
    const summary = await runRetentionCleanup(
      makeIo(db, auth, {
        deleteDocs: async (paths) => {
          if (paths.some((p) => p.startsWith('publicProfiles/'))) {
            throw new Error('publicProfiles delete failed');
          }
          return makeIo(db, auth).deleteDocs(paths);
        },
      }),
    );

    expect(await exists(db, 'users/consoled/watchlist/movie_42')).toBe(true);
    expect(await exists(db, 'publicProfiles/consoled')).toBe(true);
    expect(summary.erasedOrphanDataUids).toBe(0);
    expect(await exists(db, 'orphanWatch/consoled')).toBe(true);
  });

  it('reaches a GHOST uid whose profile doc is gone but whose subcollections survive', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);
    // The shape `index.ts` chose `listDocuments()` over a query to catch: no
    // `users/ghost` document, but data underneath it. The client SDK cannot
    // enumerate that, so the harness's default `listUserUids` is a strict
    // subset of production's view — this override supplies what only the Admin
    // SDK can see, rather than leaving the case untested.
    await setDoc(doc(db, 'users', 'ghost', 'watchlist', 'movie_7'), { tmdbId: 7 });
    await setDoc(doc(db, 'publicProfiles', 'ghost'), { displayName: 'ghost' });
    await setDoc(doc(db, 'orphanWatch', 'ghost'), {
      firstSeenAt: NOW - ORPHAN_DATA_MIN_OBSERVED_MS - 1,
    });
    expect(await exists(db, 'users/ghost')).toBe(false);

    const summary = await runRetentionCleanup(
      makeIo(db, auth, {
        listUserUids: async () => {
          const snap = await getDocs(query(collection(db, 'users'), orderBy(documentId())));
          return [...snap.docs.map((d) => d.id), 'ghost'];
        },
      }),
    );

    expect(summary.erasedOrphanDataUids).toBeGreaterThanOrEqual(1);
    expect(await exists(db, 'users/ghost/watchlist/movie_7')).toBe(false);
    expect(await exists(db, 'publicProfiles/ghost')).toBe(false);
  });

  it('a dead scan reports -1, not a zero that reads as "everyone has an account"', async () => {
    const db = adminLikeDb();
    const auth = makeAuth(ORPHAN_DATA_ACCOUNTS);
    await seedOrphanData(db);

    const summary = await runRetentionCleanup(
      makeIo(db, auth, {
        listUserUids: async () => { throw new Error('listDocuments failed'); },
      }),
    );

    expect(summary.checkedUserRoots).toBe(-1);
    expect(summary.orphanDataSkippedAuthBatches).toBe(-1);
    expect(summary.erasedOrphanDataUids).toBe(0);
    expect(await exists(db, 'users/consoled')).toBe(true);
  });
});
