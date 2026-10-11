import { describe, it, expect } from 'vitest';

import {
  FALLBACK_FOLLOWER_NAME,
  FOLLOWER_NAME_MAX_CHARS,
  FOLLOW_NOTICE_FRESH_MS,
  FOLLOW_PUSH_CAP_PER_WINDOW,
  FOLLOW_PUSH_CAP_WINDOW_MS,
  FOLLOW_PUSH_MARKER_MAX_AGE_MS,
  FOLLOW_PUSH_WINDOW_MS,
  buildFollowNotice,
  followNoticeSkipReason,
  followPushPairId,
  followPushRateId,
  followerDisplayName,
  followerProfileUrl,
  gateFollowNotice,
  isStaleFollowPushMarker,
  recipientPushEnabled,
  wantsFollowNotice,
  type FollowNoticeContext,
} from './logic';

const NOW = Date.parse('2026-10-11T12:00:00Z');

const NO_MARKERS = { pairLastPushedAtMs: null, rateWindowStartedAtMs: null, rateCount: 0 };

describe('gateFollowNotice — the pair window', () => {
  it('lets a pair that has never notified through, and stamps both markers at now', () => {
    expect(gateFollowNotice(NO_MARKERS, NOW)).toEqual({
      send: true,
      pair: { lastPushedAtMs: NOW },
      rate: { windowStartedAtMs: NOW, count: 1, lastPushedAtMs: NOW },
    });
  });

  // Literal offsets in both directions: `<=` would hold a notice exactly one window
  // old, and the other way round would let one through a millisecond early.
  it('holds a re-follow one millisecond inside the window and allows it exactly at the edge', () => {
    expect(gateFollowNotice({ ...NO_MARKERS, pairLastPushedAtMs: NOW - FOLLOW_PUSH_WINDOW_MS + 1 }, NOW))
      .toEqual({ send: false, reason: 'recent-pair' });
    expect(gateFollowNotice({ ...NO_MARKERS, pairLastPushedAtMs: NOW - FOLLOW_PUSH_WINDOW_MS }, NOW).send)
      .toBe(true);
  });

  it('holds a follow, unfollow, follow loop a minute apart', () => {
    expect(gateFollowNotice({ ...NO_MARKERS, pairLastPushedAtMs: NOW - 60_000 }, NOW))
      .toEqual({ send: false, reason: 'recent-pair' });
  });

  it('the pair window is one day', () => {
    expect(FOLLOW_PUSH_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('gateFollowNotice — the hourly cap per recipient', () => {
  const windowStart = NOW - 10 * 60_000;

  it('the cap is five per hour', () => {
    expect(FOLLOW_PUSH_CAP_PER_WINDOW).toBe(5);
    expect(FOLLOW_PUSH_CAP_WINDOW_MS).toBe(60 * 60 * 1000);
  });

  it('lets the fifth notice of the hour through and holds the sixth', () => {
    expect(gateFollowNotice({ ...NO_MARKERS, rateWindowStartedAtMs: windowStart, rateCount: 4 }, NOW))
      .toEqual({
        send: true,
        pair: { lastPushedAtMs: NOW },
        rate: { windowStartedAtMs: windowStart, count: 5, lastPushedAtMs: NOW },
      });
    expect(gateFollowNotice({ ...NO_MARKERS, rateWindowStartedAtMs: windowStart, rateCount: 5 }, NOW))
      .toEqual({ send: false, reason: 'hourly-cap' });
  });

  it('a full window still holds one millisecond before it ends, and opens a new window exactly at its end', () => {
    expect(gateFollowNotice(
      { ...NO_MARKERS, rateWindowStartedAtMs: NOW - FOLLOW_PUSH_CAP_WINDOW_MS + 1, rateCount: 5 }, NOW,
    )).toEqual({ send: false, reason: 'hourly-cap' });
    expect(gateFollowNotice(
      { ...NO_MARKERS, rateWindowStartedAtMs: NOW - FOLLOW_PUSH_CAP_WINDOW_MS, rateCount: 5 }, NOW,
    )).toEqual({
      send: true,
      pair: { lastPushedAtMs: NOW },
      rate: { windowStartedAtMs: NOW, count: 1, lastPushedAtMs: NOW },
    });
  });

  it('a count with no window start reads as a fresh window', () => {
    expect(gateFollowNotice({ ...NO_MARKERS, rateCount: 99 }, NOW).send).toBe(true);
  });

  it('the pair window is checked before the cap, so a re-follow never uses up a cap slot', () => {
    expect(gateFollowNotice(
      { pairLastPushedAtMs: NOW - 1000, rateWindowStartedAtMs: windowStart, rateCount: 5 }, NOW,
    )).toEqual({ send: false, reason: 'recent-pair' });
  });
});

describe('isStaleFollowPushMarker', () => {
  it('keeps a marker that is still inside the pair window', () => {
    expect(isStaleFollowPushMarker(NOW - 60_000, NOW)).toBe(false);
  });

  it('reaps a marker one millisecond past the max age, and keeps one exactly at it', () => {
    expect(isStaleFollowPushMarker(NOW - FOLLOW_PUSH_MARKER_MAX_AGE_MS - 1, NOW)).toBe(true);
    expect(isStaleFollowPushMarker(NOW - FOLLOW_PUSH_MARKER_MAX_AGE_MS, NOW)).toBe(false);
  });

  it('never reaps a marker with no readable stamp', () => {
    expect(isStaleFollowPushMarker(null, NOW)).toBe(false);
  });

  // A reaped marker reads as "never notified", so a max age inside either window
  // would silently shorten the brake.
  it('the max age outlasts both windows', () => {
    expect(FOLLOW_PUSH_MARKER_MAX_AGE_MS).toBeGreaterThan(FOLLOW_PUSH_WINDOW_MS);
    expect(FOLLOW_PUSH_MARKER_MAX_AGE_MS).toBeGreaterThan(FOLLOW_PUSH_CAP_WINDOW_MS);
  });
});

describe('marker ids', () => {
  it('orders recipient before follower, so the two directions are different markers', () => {
    expect(followPushPairId('anna', 'bo')).toBe('anna_bo');
    expect(followPushPairId('bo', 'anna')).not.toBe(followPushPairId('anna', 'bo'));
  });

  it('the cap marker is the bare recipient uid, which no pair id can equal', () => {
    expect(followPushRateId('anna')).toBe('anna');
    expect(followPushPairId('anna', 'bo')).not.toBe(followPushRateId('anna'));
  });
});

describe('followNoticeSkipReason', () => {
  const ctx = (over: Partial<FollowNoticeContext> = {}): FollowNoticeContext => ({
    recipientUid: 'recipient',
    followerUid: 'follower',
    followedAtMs: NOW - 2000,
    recipientProfile: { notificationSettings: { pushEnabled: true } },
    recipientBlockedFollower: false,
    followerProfile: { displayName: 'Anna' },
    nowMs: NOW,
    ...over,
  });

  it('a fresh follow between two existing accounts goes on to the markers', () => {
    expect(followNoticeSkipReason(ctx())).toBeNull();
  });

  it('a recipient who blocked the follower gets nothing', () => {
    expect(followNoticeSkipReason(ctx({ recipientBlockedFollower: true }))).toBe('blocked');
  });

  it('an explicit followNotify false turns the notice off', () => {
    expect(followNoticeSkipReason(ctx({
      recipientProfile: { notificationSettings: { followNotify: false, pushEnabled: true } },
    }))).toBe('opted-out');
  });

  it('a profile without the key, or without notificationSettings at all, still gets it', () => {
    expect(followNoticeSkipReason(ctx({ recipientProfile: { notificationSettings: { pushEnabled: false } } }))).toBeNull();
    expect(followNoticeSkipReason(ctx({ recipientProfile: {} }))).toBeNull();
    expect(followNoticeSkipReason(ctx({ recipientProfile: { notificationSettings: { followNotify: true } } }))).toBeNull();
  });

  it('a follower with no profile is not announced', () => {
    expect(followNoticeSkipReason(ctx({ followerProfile: null }))).toBe('follower-missing');
  });

  it('a recipient with no profile gets nothing', () => {
    expect(followNoticeSkipReason(ctx({ recipientProfile: null }))).toBe('recipient-missing');
  });

  it('following yourself announces nothing', () => {
    expect(followNoticeSkipReason(ctx({ followerUid: 'recipient' }))).toBe('self');
  });

  it('a follow stamped one millisecond past the freshness window is a copy, exactly at it is fresh', () => {
    expect(followNoticeSkipReason(ctx({ followedAtMs: NOW - FOLLOW_NOTICE_FRESH_MS - 1 }))).toBe('not-fresh');
    expect(followNoticeSkipReason(ctx({ followedAtMs: NOW - FOLLOW_NOTICE_FRESH_MS }))).toBeNull();
  });

  it('a follow document without a readable followedAt is not announced', () => {
    expect(followNoticeSkipReason(ctx({ followedAtMs: null }))).toBe('not-fresh');
  });
});

describe('the recipient settings readers', () => {
  it('wantsFollowNotice is off only on an explicit false', () => {
    expect(wantsFollowNotice({ notificationSettings: { followNotify: false } })).toBe(false);
    expect(wantsFollowNotice({ notificationSettings: { followNotify: 'false' } })).toBe(true);
    expect(wantsFollowNotice({})).toBe(true);
  });

  it('recipientPushEnabled is on only on an explicit true, like sendPushToUser', () => {
    expect(recipientPushEnabled({ notificationSettings: { pushEnabled: true } })).toBe(true);
    expect(recipientPushEnabled({ notificationSettings: { pushEnabled: 'true' } })).toBe(false);
    expect(recipientPushEnabled({})).toBe(false);
  });
});

describe('followerDisplayName', () => {
  it('uses the display name from the follower profile', () => {
    expect(followerDisplayName({ displayName: 'Anna Svensson', username: 'anna' })).toBe('Anna Svensson');
  });

  it('keeps a name of exactly the maximum length whole', () => {
    const name = 'a'.repeat(FOLLOWER_NAME_MAX_CHARS);
    expect(followerDisplayName({ displayName: name })).toBe(name);
  });

  it('cuts a name one character over the maximum and ends it with an ellipsis', () => {
    const shown = followerDisplayName({ displayName: 'a'.repeat(FOLLOWER_NAME_MAX_CHARS + 1) });
    expect(Array.from(shown)).toHaveLength(FOLLOWER_NAME_MAX_CHARS);
    expect(shown.endsWith('…')).toBe(true);
  });

  it('counts code points, so an emoji is never split in half', () => {
    const shown = followerDisplayName({ displayName: '😀'.repeat(FOLLOWER_NAME_MAX_CHARS + 5) });
    expect(shown).toBe(`${'😀'.repeat(FOLLOWER_NAME_MAX_CHARS - 1)}…`);
  });

  it('turns line breaks and other control characters into single spaces', () => {
    expect(followerDisplayName({ displayName: 'Anna\n\nSvensson\u0007' })).toBe('Anna Svensson');
  });

  it('falls back to the handle, then to Någon', () => {
    expect(followerDisplayName({ displayName: '   ', username: 'anna-s' })).toBe('@anna-s');
    expect(followerDisplayName({ displayName: 42, username: 'Not A Handle' })).toBe(FALLBACK_FOLLOWER_NAME);
    expect(followerDisplayName({})).toBe('Någon');
  });
});

describe('followerProfileUrl and buildFollowNotice', () => {
  it('links to the follower profile by handle', () => {
    expect(followerProfileUrl({ username: 'anna-s' })).toBe('/user/anna-s/');
  });

  it('links to Vänner when the follower has no valid handle', () => {
    expect(followerProfileUrl({})).toBe('/my/friends/');
    expect(followerProfileUrl({ username: '../admin' })).toBe('/my/friends/');
  });

  it('says who follows you, in Swedish', () => {
    expect(buildFollowNotice({ displayName: 'Anna', username: 'anna' })).toEqual({
      title: 'Ny följare',
      body: 'Anna följer dig nu',
      actionUrl: '/user/anna/',
    });
  });
});
