import { describe, it, expect } from 'vitest';
import { isOrphanFollow, isReclaimableOrphan, parseFollowedAt, type FollowRef } from './logic';

const alive = new Set(['a', 'b', 'c']);
const followingRef = (ownerUid: string, otherUid: string): FollowRef => ({ kind: 'following', ownerUid, otherUid });
const followersRef = (ownerUid: string, otherUid: string): FollowRef => ({ kind: 'followers', ownerUid, otherUid });

describe('isOrphanFollow', () => {
  it('not orphan when both endpoints alive', () => {
    expect(isOrphanFollow(followingRef('a', 'b'), alive)).toBe(false);
    expect(isOrphanFollow(followersRef('a', 'b'), alive)).toBe(false);
  });

  it('orphan when owner is gone (deleted account leftover)', () => {
    expect(isOrphanFollow(followingRef('gone', 'b'), alive)).toBe(true);
    expect(isOrphanFollow(followersRef('gone', 'b'), alive)).toBe(true);
  });

  it('orphan when the other endpoint is gone (dangling follow on a live user)', () => {
    expect(isOrphanFollow(followingRef('a', 'gone'), alive)).toBe(true);
    expect(isOrphanFollow(followersRef('a', 'gone'), alive)).toBe(true);
  });

  it('orphan when both endpoints are gone', () => {
    expect(isOrphanFollow(followingRef('gone1', 'gone2'), alive)).toBe(true);
    expect(isOrphanFollow(followersRef('gone1', 'gone2'), alive)).toBe(true);
  });

  it('treats the two kinds identically — orphan-ness is endpoint existence, not direction', () => {
    // Explicit expected values (not call-vs-call) so this guards against a
    // future regression that introduces `kind` as a discriminant.
    expect(isOrphanFollow(followingRef('a', 'gone'), alive)).toBe(true);
    expect(isOrphanFollow(followersRef('a', 'gone'), alive)).toBe(true);
    expect(isOrphanFollow(followingRef('a', 'b'), alive)).toBe(false);
    expect(isOrphanFollow(followersRef('a', 'b'), alive)).toBe(false);
  });
});

describe('isReclaimableOrphan (BIN-50 grace window)', () => {
  // Run started at t=1_000_000; grace already subtracted by the caller.
  const cutoffMs = 1_000_000;

  it('reclaims a genuine orphan whose follow predates the cutoff', () => {
    expect(isReclaimableOrphan({ ref: followingRef('a', 'gone'), followedAtMs: 500_000 }, alive, cutoffMs)).toBe(true);
    expect(isReclaimableOrphan({ ref: followersRef('gone', 'b'), followedAtMs: 0 }, alive, cutoffMs)).toBe(true);
  });

  it('reclaims at exactly cutoffMs-1 (reclaim side of the boundary)', () => {
    // Two-sided boundary guard: cutoffMs itself is protected (below), cutoffMs-1
    // is reclaimed. Pins the comparison so flipping >= to > is caught both ways.
    expect(isReclaimableOrphan({ ref: followingRef('a', 'gone'), followedAtMs: cutoffMs - 1 }, alive, cutoffMs)).toBe(true);
  });

  it('reclaims a legacy orphan with no followedAt (treated as old)', () => {
    expect(isReclaimableOrphan({ ref: followingRef('a', 'gone'), followedAtMs: null }, alive, cutoffMs)).toBe(true);
  });

  it('NEVER reclaims a fresh follow even if an endpoint looks missing (read-skew guard)', () => {
    // The data-loss path: a user registers mid-sweep so isn't in `alive` yet,
    // and their brand-new follow has followedAt >= cutoff. Must be protected.
    expect(isReclaimableOrphan({ ref: followingRef('a', 'gone'), followedAtMs: cutoffMs }, alive, cutoffMs)).toBe(false);
    expect(isReclaimableOrphan({ ref: followingRef('a', 'gone'), followedAtMs: 2_000_000 }, alive, cutoffMs)).toBe(false);
  });

  it('never reclaims a follow whose endpoints are both alive, regardless of age', () => {
    expect(isReclaimableOrphan({ ref: followingRef('a', 'b'), followedAtMs: 0 }, alive, cutoffMs)).toBe(false);
    expect(isReclaimableOrphan({ ref: followingRef('a', 'b'), followedAtMs: 5_000_000 }, alive, cutoffMs)).toBe(false);
  });
});

describe('parseFollowedAt (BIN-50 load-bearing converter)', () => {
  it('reads epoch ms from a Timestamp-like object (has toMillis)', () => {
    expect(parseFollowedAt({ toMillis: () => 1_700_000_000_000 })).toBe(1_700_000_000_000);
  });

  it('returns null for missing / legacy / non-timestamp shapes', () => {
    expect(parseFollowedAt(undefined)).toBe(null); // field absent (legacy doc)
    expect(parseFollowedAt(null)).toBe(null);
    expect(parseFollowedAt(1_700_000_000_000)).toBe(null); // a raw number, not a Timestamp
    expect(parseFollowedAt('2026-01-01')).toBe(null);
    expect(parseFollowedAt({})).toBe(null); // object without toMillis
  });

  it('returns null when toMillis yields a non-finite value', () => {
    expect(parseFollowedAt({ toMillis: () => NaN })).toBe(null);
    expect(parseFollowedAt({ toMillis: () => Infinity })).toBe(null);
  });
});
