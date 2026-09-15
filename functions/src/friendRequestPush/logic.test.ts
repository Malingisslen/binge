import { describe, it, expect } from 'vitest';

import {
  FRIEND_REQUEST_PUSH_MARKER_MAX_AGE_MS,
  FRIEND_REQUEST_PUSH_WINDOW_MS,
  friendRequestPushMarkerId,
  isStaleFriendRequestPushMarker,
  mayPushFriendRequest,
} from './logic';

const NOW = Date.parse('2026-09-15T12:00:00Z');

describe('mayPushFriendRequest', () => {
  it('pushes a pair that has never pushed', () => {
    expect(mayPushFriendRequest(null, NOW)).toBe(true);
  });

  // The boundary in both directions with literal offsets: `>` instead of `>=`
  // would hold back a push that is exactly one window old, and `<` the other way
  // would let one through a millisecond early.
  it('holds a push one millisecond inside the window and allows it exactly at the edge', () => {
    expect(mayPushFriendRequest(NOW - FRIEND_REQUEST_PUSH_WINDOW_MS + 1, NOW)).toBe(false);
    expect(mayPushFriendRequest(NOW - FRIEND_REQUEST_PUSH_WINDOW_MS, NOW)).toBe(true);
  });

  it('holds a push sent a minute ago', () => {
    expect(mayPushFriendRequest(NOW - 60_000, NOW)).toBe(false);
  });

  it('the window is one day', () => {
    expect(FRIEND_REQUEST_PUSH_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('isStaleFriendRequestPushMarker', () => {
  it('keeps a marker that is still inside the push window', () => {
    expect(isStaleFriendRequestPushMarker(NOW - 60_000, NOW)).toBe(false);
  });

  it('reaps a marker one millisecond past the max age, and keeps one exactly at it', () => {
    expect(isStaleFriendRequestPushMarker(NOW - FRIEND_REQUEST_PUSH_MARKER_MAX_AGE_MS - 1, NOW)).toBe(true);
    expect(isStaleFriendRequestPushMarker(NOW - FRIEND_REQUEST_PUSH_MARKER_MAX_AGE_MS, NOW)).toBe(false);
  });

  it('never reaps a marker with no readable stamp', () => {
    expect(isStaleFriendRequestPushMarker(null, NOW)).toBe(false);
  });

  // A reaped marker reads as "never pushed", so a max age inside the window
  // would silently shorten the brake.
  it('the max age outlasts the push window', () => {
    expect(FRIEND_REQUEST_PUSH_MARKER_MAX_AGE_MS).toBeGreaterThan(FRIEND_REQUEST_PUSH_WINDOW_MS);
  });
});

describe('friendRequestPushMarkerId', () => {
  it('orders recipient before sender, so the two directions are different markers', () => {
    expect(friendRequestPushMarkerId('anna', 'bo')).toBe('anna_bo');
    expect(friendRequestPushMarkerId('bo', 'anna')).not.toBe(friendRequestPushMarkerId('anna', 'bo'));
  });
});
