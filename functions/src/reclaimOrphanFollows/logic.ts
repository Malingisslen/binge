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

/** A follow doc plus its creation time, flattened for the reclaim decision. */
export interface FollowCandidate {
  ref: FollowRef;
  /** users/{uid}/{kind}/{otherUid}.followedAt as epoch ms, or null if unset. */
  followedAtMs: number | null;
}

/**
 * Normalize a raw `followedAt` field value to epoch ms (BIN-50). Duck-typed on
 * `toMillis()` rather than `instanceof Timestamp` so this stays free of
 * firebase-admin imports and unit-tests under root vitest — the Admin SDK only
 * ever returns a real Timestamp instance (with `toMillis`) for a timestamp
 * field, since Firestore cannot store a function on any other shape. Anything
 * else — missing field, a number, a map, undefined — yields null, which
 * `isReclaimableOrphan` treats as a legacy/old doc (reclaimable). This is the
 * load-bearing converter for the whole grace window: if the caller stops
 * projecting `followedAt`, every doc collapses to null/old here.
 */
export function parseFollowedAt(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const toMillis = (raw as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== 'function') return null;
  const ms = (toMillis as () => unknown).call(raw);
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

/**
 * Should this follow actually be deleted by the sweep? (BIN-50)
 *
 * Two conditions, both required:
 *  1. An endpoint user profile is genuinely gone (`isOrphanFollow`), AND
 *  2. the follow is OLDER than `cutoffMs` (= run-start minus a grace window).
 *
 * Condition 2 closes the read-skew data-loss path: the alive-users snapshot is
 * read before the follow scan, so a user who *registers mid-sweep* isn't in that
 * set yet — a brand-new follow pointing at them would look orphaned and be
 * wrongly deleted. Because a fresh follow's `followedAt` is necessarily newer
 * than the run start, the grace window keeps it safe; a genuinely dead follow
 * (endpoint deleted long ago) has an old `followedAt` and is still reclaimed,
 * just one weekly cycle later in the worst case. A follow with no `followedAt`
 * (legacy doc predating that field) is treated as old → reclaimable.
 */
export function isReclaimableOrphan(
  candidate: FollowCandidate,
  aliveUids: Set<string>,
  cutoffMs: number,
): boolean {
  if (!isOrphanFollow(candidate.ref, aliveUids)) return false;
  if (candidate.followedAtMs !== null && candidate.followedAtMs >= cutoffMs) return false;
  return true;
}
