/**
 * BIN-1129 — the repeat-push brake for friend requests.
 *
 * A declined or cancelled request can be sent again at once, and every create
 * fires a push. So the same sender could turn send, decline, send into a stream
 * of notifications on the recipient's lock screen. The request document still
 * lands every time; only the push is held back while the pair's last push is
 * younger than the window.
 *
 * Pure, with no firebase-admin import, so it runs under the root vitest
 * toolchain like `retentionCleanup/logic.ts`.
 */

/** How long after one push the same sender cannot push the same recipient again. */
export const FRIEND_REQUEST_PUSH_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Markers older than this are reaped by `retentionCleanup`. The marker only
 * matters inside the window above; the margin keeps a marker that is still
 * doing its job from being reaped by a sweep that runs once a day.
 */
export const FRIEND_REQUEST_PUSH_MARKER_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** The marker document id for one (recipient, sender) pair. */
export function friendRequestPushMarkerId(recipientUid: string, fromUid: string): string {
  return `${recipientUid}_${fromUid}`;
}

/**
 * Whether a new request may push. `lastPushedAtMs` is null when the pair has
 * never pushed, or when its marker has already been reaped.
 */
export function mayPushFriendRequest(lastPushedAtMs: number | null, nowMs: number): boolean {
  return lastPushedAtMs === null || nowMs - lastPushedAtMs >= FRIEND_REQUEST_PUSH_WINDOW_MS;
}

/** Whether `retentionCleanup` may delete a marker last stamped at `lastPushedAtMs`. */
export function isStaleFriendRequestPushMarker(lastPushedAtMs: number | null, nowMs: number): boolean {
  return lastPushedAtMs !== null && lastPushedAtMs < nowMs - FRIEND_REQUEST_PUSH_MARKER_MAX_AGE_MS;
}
