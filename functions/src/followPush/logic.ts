/**
 * "Någon följer dig nu" — the decisions behind the follow notice.
 *
 * Following is one tap and unfollowing is another, so without a brake the same
 * person could turn follow, unfollow, follow into a stream of notices on the
 * recipient's lock screen, and a handful of accounts could flood one recipient.
 * Two markers in `followPushes` hold that back: one per (recipient, follower)
 * pair, and one per recipient that counts notices in a fixed one-hour window.
 * The follow itself always lands; only the notice is held back.
 *
 * Pure, with no firebase-admin import, so it runs under the root vitest
 * toolchain like `friendRequestPush/logic.ts`.
 */

/** How long after one notice the same follower cannot notify the same recipient again. */
export const FOLLOW_PUSH_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The per-recipient window the cap below counts within. */
export const FOLLOW_PUSH_CAP_WINDOW_MS = 60 * 60 * 1000;

/** At most this many follow notices reach one recipient per cap window. */
export const FOLLOW_PUSH_CAP_PER_WINDOW = 5;

/**
 * Markers older than this are reaped by `retentionCleanup`. A marker only matters
 * inside the pair window above; the margin keeps one that is still doing its job
 * from being reaped by a sweep that runs once a day.
 */
export const FOLLOW_PUSH_MARKER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A follow document whose `followedAt` is older than this when the trigger runs
 * is not a fresh tap. `followUser` stamps it with the server time in the same
 * batch, so a real follow is seconds old; an old stamp comes from an admin copy
 * such as the account-restore script, which writes relations back with their
 * original dates and must not announce them as new.
 */
export const FOLLOW_NOTICE_FRESH_MS = 60 * 60 * 1000;

/** Longest follower name a notice shows, counted in code points. */
export const FOLLOWER_NAME_MAX_CHARS = 40;

/** Shown when the follower's profile carries no usable name. */
export const FALLBACK_FOLLOWER_NAME = 'Någon';

/** The pair marker's document id. */
export function followPushPairId(recipientUid: string, followerUid: string): string {
  return `${recipientUid}_${followerUid}`;
}

/**
 * The per-recipient cap marker's document id: the bare uid. It cannot collide
 * with a pair id, which always carries the `_` that joins two uids.
 */
export function followPushRateId(recipientUid: string): string {
  return recipientUid;
}

export type FollowNoticeSkip =
  | 'self'
  | 'not-fresh'
  | 'recipient-missing'
  | 'opted-out'
  | 'blocked'
  | 'follower-missing';

export interface FollowNoticeContext {
  recipientUid: string;
  followerUid: string;
  /** `followedAt` on the created follower document, null when absent or not a timestamp. */
  followedAtMs: number | null;
  /** `users/{recipient}`, null when it does not exist. */
  recipientProfile: Record<string, unknown> | null;
  /** Whether `users/{recipient}/blocked/{follower}` exists. */
  recipientBlockedFollower: boolean;
  /** `users/{follower}`, null when it does not exist. */
  followerProfile: Record<string, unknown> | null;
  nowMs: number;
}

/** Only an explicit false turns the notice off; an account without the key gets it. */
export function wantsFollowNotice(recipientProfile: Record<string, unknown>): boolean {
  const settings = recipientProfile.notificationSettings as Record<string, unknown> | undefined;
  return settings?.followNotify !== false;
}

/** Same reading as `sendPushToUser`: push only on an explicit true. */
export function recipientPushEnabled(recipientProfile: Record<string, unknown>): boolean {
  const settings = recipientProfile.notificationSettings as Record<string, unknown> | undefined;
  return settings?.pushEnabled === true;
}

/** Why no notice goes out, or null when the markers decide. Reads nothing. */
export function followNoticeSkipReason(ctx: FollowNoticeContext): FollowNoticeSkip | null {
  if (ctx.recipientUid === ctx.followerUid) return 'self';
  if (ctx.followedAtMs === null || ctx.nowMs - ctx.followedAtMs > FOLLOW_NOTICE_FRESH_MS) return 'not-fresh';
  if (ctx.recipientProfile === null) return 'recipient-missing';
  if (!wantsFollowNotice(ctx.recipientProfile)) return 'opted-out';
  if (ctx.recipientBlockedFollower) return 'blocked';
  // A follower with no profile is an account on its way out, not someone to announce.
  if (ctx.followerProfile === null) return 'follower-missing';
  return null;
}

/** The two markers as the transaction read them. Null fields: no marker, or no readable stamp. */
export interface FollowMarkerState {
  pairLastPushedAtMs: number | null;
  rateWindowStartedAtMs: number | null;
  rateCount: number;
}

export type FollowGate =
  | {
      send: true;
      pair: { lastPushedAtMs: number };
      rate: { windowStartedAtMs: number; count: number; lastPushedAtMs: number };
    }
  | { send: false; reason: 'recent-pair' | 'hourly-cap' };

/**
 * Whether this follow may notify, and what both markers become when it does.
 * A held-back notice writes nothing, so neither clock moves on a refusal.
 */
export function gateFollowNotice(state: FollowMarkerState, nowMs: number): FollowGate {
  if (state.pairLastPushedAtMs !== null && nowMs - state.pairLastPushedAtMs < FOLLOW_PUSH_WINDOW_MS) {
    return { send: false, reason: 'recent-pair' };
  }
  const start = state.rateWindowStartedAtMs;
  const openStart = start !== null && nowMs - start < FOLLOW_PUSH_CAP_WINDOW_MS ? start : null;
  const used = openStart !== null ? state.rateCount : 0;
  if (used >= FOLLOW_PUSH_CAP_PER_WINDOW) return { send: false, reason: 'hourly-cap' };
  return {
    send: true,
    pair: { lastPushedAtMs: nowMs },
    rate: {
      windowStartedAtMs: openStart ?? nowMs,
      count: used + 1,
      lastPushedAtMs: nowMs,
    },
  };
}

/** Whether `retentionCleanup` may delete a marker last stamped at `lastPushedAtMs`. */
export function isStaleFollowPushMarker(lastPushedAtMs: number | null, nowMs: number): boolean {
  return lastPushedAtMs !== null && lastPushedAtMs < nowMs - FOLLOW_PUSH_MARKER_MAX_AGE_MS;
}

// Control characters would break the line on a lock screen.
const CONTROL_CHARS = /\p{Cc}+/gu;

function clean(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim() : '';
}

function truncate(name: string): string {
  const points = Array.from(name);
  if (points.length <= FOLLOWER_NAME_MAX_CHARS) return name;
  return `${points.slice(0, FOLLOWER_NAME_MAX_CHARS - 1).join('').trimEnd()}…`;
}

/** The same shape `src/lib/firebase/username.ts` accepts. */
const USERNAME_RE = /^[a-z0-9]([a-z0-9-]{1,18}[a-z0-9])?$/;

function validUsername(raw: unknown): string | null {
  return typeof raw === 'string' && USERNAME_RE.test(raw) ? raw : null;
}

/** The follower's name as the notice shows it, read from their own profile. */
export function followerDisplayName(followerProfile: Record<string, unknown>): string {
  const displayName = clean(followerProfile.displayName);
  if (displayName) return truncate(displayName);
  const username = validUsername(followerProfile.username);
  return username ? `@${username}` : FALLBACK_FOLLOWER_NAME;
}

/** Where the notice leads: the follower's profile, or Vänner when they have no handle. */
export function followerProfileUrl(followerProfile: Record<string, unknown>): string {
  const username = validUsername(followerProfile.username);
  return username ? `/user/${username}/` : '/my/friends/';
}

export interface FollowNotice {
  title: string;
  body: string;
  actionUrl: string;
}

export function buildFollowNotice(followerProfile: Record<string, unknown>): FollowNotice {
  return {
    title: 'Ny följare',
    body: `${followerDisplayName(followerProfile)} följer dig nu`,
    actionUrl: followerProfileUrl(followerProfile),
  };
}
