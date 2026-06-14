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
 * following/followers doc whose owner OR other endpoint is not in that Set is an
 * orphan (see logic.ts). The Admin SDK bypasses firestore.rules, so no rule
 * change is needed.
 *
 * Cost: reads = #users + #following docs + #followers docs, deletes only for
 * actual orphans. A few hundred ops/week at binge's size — well under the free
 * tier. Idempotent: a second run finds nothing.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import type { DocumentReference } from 'firebase-admin/firestore';
import { isOrphanFollow, type FollowKind, type FollowRef } from './logic';

/** Firestore's per-commit write ceiling is 500; leave headroom like the client. */
const BATCH_SIZE = 450;

/** All uids whose users/{uid} profile still exists (id-only read, minimal egress). */
async function readAliveUids(): Promise<Set<string>> {
  const snap = await getFirestore().collection('users').select().get();
  return new Set(snap.docs.map((d) => d.id));
}

/**
 * Scan a follow collection-group and return the orphaned doc refs. ownerUid is
 * the users/{uid} that contains the subcollection; otherUid is the doc id.
 */
async function collectOrphans(kind: FollowKind, aliveUids: Set<string>): Promise<DocumentReference[]> {
  const snap = await getFirestore().collectionGroup(kind).select().get();
  const orphans: DocumentReference[] = [];
  for (const d of snap.docs) {
    const ownerUid = d.ref.parent.parent?.id;
    if (!ownerUid) continue; // not under users/{uid}/{kind}/ — skip defensively
    const ref: FollowRef = { kind, ownerUid, otherUid: d.id };
    if (isOrphanFollow(ref, aliveUids)) orphans.push(d.ref);
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
    let aliveUids: Set<string>;
    try {
      aliveUids = await readAliveUids();
    } catch (err) {
      logger.error('reclaimOrphanFollows: users scan failed', err);
      return;
    }

    const [followingOrphans, followersOrphans] = await Promise.all([
      collectOrphans('following', aliveUids).catch((err) => {
        logger.error('reclaimOrphanFollows: following scan failed', err);
        return [] as DocumentReference[];
      }),
      collectOrphans('followers', aliveUids).catch((err) => {
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
