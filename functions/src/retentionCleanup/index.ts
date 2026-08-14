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
 *   - users/{uid}/fcmTokens/* — for uids Auth no longer honours (BIN-848): the
 *     account was deleted or disabled from the Firebase Console, which leaves
 *     every Firestore doc in place, so sendPushToUser (which gates on the profile
 *     doc, never on Auth) keeps pushing to that person's device forever. FCM's own
 *     self-heal misses it because the token is still valid on a live browser. Note
 *     this sweep is NOT about sessions merely lapsing — a closed browser must keep
 *     receiving push; that is the point of push.
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
 *
 * WHERE THE LOGIC LIVES (BIN-727). This file is now only the Admin-SDK PORT plus
 * the schedule wrapper: one method per Firestore/Auth operation, no decisions.
 * Every decision — paging, which docs each TTL reaps, the uid derivation, the
 * "a failed lookup is not a deletion licence" rule, the orphan ceiling, the
 * per-category error isolation and the −1-vs-0 summary discipline — lives in
 * ./runCleanup.ts, which imports no firebase-admin and is therefore drivable by
 * src/test/rules/retention-cleanup-orchestrator.test.ts against a real Firestore
 * emulator with an Auth double. Before that split the orchestration was untested
 * and a silent stop would have logged "done" with a zero (#27's review, the
 * reason this ticket exists).
 *
 * Sessions own subcollections (participants/*, swipes/*), so a plain doc delete
 * would orphan them — the port uses recursiveDelete() to reap the whole session
 * tree. Notifications and the other leaf docs are chunked batch deletes.
 *
 * Bounded pagination (PAGE_SIZE) + per-page filtering mirrors reclaimOrphanFollows
 * (BIN-50): never load a whole collection in one query result; peak memory stays
 * page-size + matches. Idempotent — a second run finds nothing. The Admin SDK
 * bypasses firestore.rules.
 *
 * IAM: this function calls Admin Auth's `getUsers`, `listUsers` AND `deleteUsers`,
 * so `firebaseauth.users.delete` is required on top of the read scopes. See
 * docs/analysis/EXTERNAL_ACTIONS.md — a missing role makes those batches throw
 * while the deploy stays green, which is exactly what the `checkedUids` /
 * `checkedAuthAccounts` counters in the summary exist to expose.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import type { Query } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { runRetentionCleanup, type CleanupIo, type ScanKind } from './runCleanup';

/** Firestore's per-commit write ceiling is 500; leave headroom like the client. */
const BATCH_SIZE = 450;

/** Page size for the bounded scans — never load a whole collection at once. */
const PAGE_SIZE = 2000;

/** How many document refs to put to a single `getAll()`. */
const GET_ALL_BATCH = 300;

/**
 * The base query per scan, field projection included.
 *
 * `.select(...)` is load-bearing in both directions: it keeps the scans cheap AND
 * it is what the orchestrator's predicates read. Drop or misspell a field here
 * and every doc in that category reads as undateable → nothing is ever reaped,
 * with no error anywhere. (The emulator harness implements this port with the
 * client SDK, which has no `.select()`, so it reads the FULL doc — a superset of
 * these fields. It therefore proves the predicates and the loop, but it is
 * structurally unable to catch a wrong projection list. This comment is that
 * gap's only guard.)
 *
 * The collection-group scans page by `__name__` on Firestore's automatic
 * collection-group index — no firestore.indexes.json entry needed (a single-field
 * `__name__` index isn't a composite).
 */
function baseQuery(kind: ScanKind): Query {
  const db = getFirestore();
  switch (kind) {
    case 'sessions':
      return db.collection('sessions').select('expiresAt', 'createdAt');
    case 'notifications':
      return db.collectionGroup('notifications').select('createdAt');
    case 'joinAttempts':
      return db.collectionGroup('joinAttempts').select('createdAt');
    case 'releaseMarkers':
      // The age field here is `updatedAt` (what the marker stamps), not `createdAt`.
      return db.collectionGroup('notified').select('updatedAt');
    case 'fcmTokens':
      // `.select()` with no fields returns refs only — this scan never reads a
      // token value; the owner uid comes from the ref's own path.
      return db.collectionGroup('fcmTokens').select();
    case 'usernames':
      return db.collection('usernames').select('uid');
  }
}

/** The production port: one Admin-SDK operation per method, no decisions. */
const adminIo: CleanupIo = {
  pageSize: PAGE_SIZE,
  deleteBatchSize: BATCH_SIZE,
  profileBatchSize: GET_ALL_BATCH,
  log: logger,
  now: () => Date.now(),

  scanPage: async (kind, cursor, pageSize) => {
    const db = getFirestore();
    let q = baseQuery(kind).orderBy('__name__').limit(pageSize);
    if (cursor) q = q.startAfter(db.doc(cursor));
    const snap = await q.get();
    return snap.docs.map((d) => ({ path: d.ref.path, data: d.data() as Record<string, unknown> }));
  },

  deleteDocs: async (paths) => {
    const db = getFirestore();
    const batch = db.batch();
    for (const path of paths) batch.delete(db.doc(path));
    await batch.commit();
  },

  deleteSessionTree: async (path) => {
    const db = getFirestore();
    await db.recursiveDelete(db.doc(path));
  },

  profilesExist: async (uids) => {
    const db = getFirestore();
    const snaps = await db.getAll(...uids.map((uid) => db.doc(`users/${uid}`)));
    return snaps.map((snap) => snap.exists);
  },

  lookupUsers: (uids) => getAuth().getUsers(uids.map((uid) => ({ uid }))),

  listAuthAccounts: async (pageToken) => {
    const page = await getAuth().listUsers(1000, pageToken);
    return { users: page.users, pageToken: page.pageToken };
  },

  deleteAuthUsers: async (uids) => {
    const res = await getAuth().deleteUsers([...uids]);
    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
      errors: res.errors.map((e) => ({ message: e.error.message })),
    };
  },
};

export const retentionCleanup = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    await runRetentionCleanup(adminIo);
  },
);
