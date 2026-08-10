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
import { isExpiredSession, isStaleNotification, isStaleJoinAttempt, isStaleReleaseMarker, tsToMillis, revokedUidsInBatches } from './logic';

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
 * Cadence note (#27 DBA asked for weekly): kept daily because it lives in a daily
 * function whose stated job this already is. The scan is a `.select()`-ed
 * collection group of a handful of docs, bounded by the same PAGE_SIZE as its
 * siblings. If device count ever makes it expensive, move the WHOLE function to a
 * sparser schedule rather than hiding a weekly branch inside a daily one.
 */
async function collectRevokedPushTokens(): Promise<{ refs: DocumentReference[]; skippedAuthBatches: number }> {
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
  if (byOwner.size === 0) return { refs: [], skippedAuthBatches: 0 };

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
  return { refs, skippedAuthBatches: skippedBatches };
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
        return { refs: [] as DocumentReference[], skippedAuthBatches: -1 };
      }),
    ]);

    const deletedSessions = await deleteSessions(expiredSessions);
    const deletedNotifications = await deleteInBatches(staleNotifications);
    const deletedJoinAttempts = await deleteInBatches(staleJoinAttempts);
    const deletedReleaseMarkers = await deleteInBatches(staleReleaseMarkers);
    const deletedRevokedTokens = await deleteInBatches(revokedPushTokens.refs);

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
    });
  },
);
