import { describe, it, expect } from 'vitest';
import { isOrphanFollow, type FollowRef } from './logic';

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
