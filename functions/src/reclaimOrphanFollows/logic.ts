/**
 * Pure orphan-detection for the follow-graph sweep — no firebase-admin imports
 * so it unit-tests under the root vitest toolchain (same split as
 * episodeNotify/logic.ts).
 */

export type FollowKind = 'following' | 'followers';

/**
 * A flattened follow doc, independent of Firestore types.
 *
 * - 'following' lives at users/{ownerUid}/following/{otherUid} — ownerUid is the
 *   follower, otherUid (doc id) is the target being followed.
 * - 'followers' lives at users/{ownerUid}/followers/{otherUid} — ownerUid is the
 *   followed user, otherUid (doc id) is the follower.
 *
 * In both cases the doc references exactly two users; if either no longer exists
 * the doc is dead weight.
 */
export interface FollowRef {
  kind: FollowKind;
  ownerUid: string; // doc.ref.parent.parent.id
  otherUid: string; // doc.id
}

/** Orphaned when either endpoint's user profile no longer exists. */
export function isOrphanFollow(ref: FollowRef, aliveUids: Set<string>): boolean {
  return !aliveUids.has(ref.ownerUid) || !aliveUids.has(ref.otherUid);
}
