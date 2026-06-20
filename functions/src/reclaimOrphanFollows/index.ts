/**
 * Scheduled orphan-follow sweep (BIN-21 storage backstop).
 *
 * onSchedule('every 168 hours', europe-west1). Reclaims follow-graph docs that
 * point at a user profile that no longer exists.
 *
 * Why this exists: when a user deletes their account, deleteAccount()
 * (src/contexts/AuthContext.tsx) cleans up OUTBOUND follows — for each
 * users/{deleted}/following/{X} it also removes the mirror
 * users/{X}/followers/{deleted}, because the deleting user owns both writes.
 * It CANNOT clean up INBOUND follows: when X follows A, both
 * users/{A}/followers/{X} and users/{X}/following/{A} are owned by X
 * (firestore.rules: `allow delete: if isOwner(followerUid)`), so the deleting
 * account A is forbidden from touching them. They linger forever.
 *
 * BIN-21 hides these "ghost" follows from users at read time (useFollowList).
 * This sweep is the storage backstop that actually reclaims them.
 *
 * Detection: read every users/* doc id into an "alive" Set, then any
 * following/followers doc whose owner OR other endpoint is not in that Set, AND
 * which is older than a grace window, is an orphan (see logic.ts). The grace
 * window (BIN-50 #1) protects follows created mid-sweep from being mistaken for
 * orphans because of read-skew against the alive snapshot. The Admin SDK
 * bypasses firestore.rules, so no rule change is needed.
 *
 * Scans are paginated (BIN-50 #2) so a growing user/follow graph never loads in
 * a single query result; per-page filtering keeps peak memory bounded.
 *
 * Cost: reads = #users + #following docs + #followers docs, deletes only for
 * actual orphans. A few hundred ops/week at binge's size — well under the free
 * tier. Idempotent: a second run finds nothing.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import type { DocumentReference, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { isReclaimableOrphan, parseFollowedAt, type FollowKind, type FollowRef } from './logic';

/** Firestore's per-commit write ceiling is 500; leave headroom like the client. */
const BATCH_SIZE = 450;

/** Page size for the bounded scans (BIN-50 #2) — never load the whole graph at once. */
const PAGE_SIZE = 2000;

/**
 * Grace window (BIN-50 #1): follows created within this window of the run start
 * are never reclaimed, so the read-skew between the alive-users snapshot and the
 * follow scan can't delete a valid follow for a just-registered user. The sweep
 * runs in seconds; 24h is a generous margin whose only cost is that a follow to
 * a user deleted right after it was made waits one extra weekly cycle.
 */
const GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * All uids whose users/{uid} profile still exists (id-only read, minimal egress),
 * read in bounded pages so one run never holds the whole user table in a single
 * query result.
 */
async function readAliveUids(): Promise<Set<string>> {
  const db = getFirestore();
  const alive = new Set<string>();
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db.collection('users').select().orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) alive.add(d.id);
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return alive;
}


/**
 * Scan a follow collection-group in bounded pages and return the doc refs that
 * are safe to reclaim. ownerUid is the users/{uid} that contains the
 * subcollection; otherUid is the doc id. Filters per page so peak memory is
 * page-size + (few) orphans, not the whole follow graph.
 */
async function collectOrphans(
  kind: FollowKind,
  aliveUids: Set<string>,
  cutoffMs: number,
): Promise<DocumentReference[]> {
  const db = getFirestore();
  const orphans: DocumentReference[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    // select('followedAt') is load-bearing: the grace window (BIN-50 #1) reads
    // this field. Dropping it makes parseFollowedAt see undefined for every doc
    // → all treated as old → grace window silently disabled. Keep it.
    let q = db.collectionGroup(kind).select('followedAt').orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const ownerUid = d.ref.parent.parent?.id;
      if (!ownerUid) continue; // not under users/{uid}/{kind}/ — skip defensively
      const ref: FollowRef = { kind, ownerUid, otherUid: d.id };
      const followedAtMs = parseFollowedAt(d.get('followedAt'));
      if (isReclaimableOrphan({ ref, followedAtMs }, aliveUids, cutoffMs)) {
        orphans.push(d.ref);
      }
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return orphans;
}

/** Delete refs in ≤BATCH_SIZE chunks; log batch failures, never throw. */
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
      logger.error('reclaimOrphanFollows: batch delete failed', err);
    }
  }
  return deleted;
}

export const reclaimOrphanFollows = onSchedule(
  { schedule: 'every 168 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    // Grace cutoff is anchored to the run start, before any reads, so follows
    // created during the sweep are always newer than it (BIN-50 #1).
    const cutoffMs = Date.now() - GRACE_MS;

    let aliveUids: Set<string>;
    try {
      aliveUids = await readAliveUids();
    } catch (err) {
      logger.error('reclaimOrphanFollows: users scan failed', err);
      return;
    }

    const [followingOrphans, followersOrphans] = await Promise.all([
      collectOrphans('following', aliveUids, cutoffMs).catch((err) => {
        logger.error('reclaimOrphanFollows: following scan failed', err);
        return [] as DocumentReference[];
      }),
      collectOrphans('followers', aliveUids, cutoffMs).catch((err) => {
        logger.error('reclaimOrphanFollows: followers scan failed', err);
        return [] as DocumentReference[];
      }),
    ]);

    const orphans = [...followingOrphans, ...followersOrphans];
    const deleted = await deleteInBatches(orphans);

    logger.info('reclaimOrphanFollows done', {
      aliveUsers: aliveUids.size,
      followingOrphans: followingOrphans.length,
      followersOrphans: followersOrphans.length,
      deleted,
    });
  },
);
