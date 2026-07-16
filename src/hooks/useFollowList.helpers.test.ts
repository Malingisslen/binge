import { describe, it, expect } from 'vitest';
import { resolveFollowRows, followFallback, type FollowProfile, type FollowListUser } from './useFollowList.helpers';

const alice: FollowListUser = { uid: 'a', displayName: 'Alice', username: 'alice', photoURL: null, isPublic: true };

// BIN-505/BIN-522: users/{uid} is owner-locked and the hook reads the
// publicProfiles projection instead. A deleted account and a private
// non-friend BOTH come back as a null card, so the old 'ghost' drop-on-read
// path is gone — every uid renders, unreadable ones as the anonymous
// 'Privat användare' fallback (dangling docs from deleted accounts are reaped
// by the weekly reclaimOrphanFollows sweep, not hidden client-side).
describe('resolveFollowRows', () => {
  it('includes resolved profiles in order', () => {
    const cache = new Map<string, FollowProfile>([['a', alice]]);
    expect(resolveFollowRows(['a'], cache)).toEqual([alice]);
  });

  it('renders unreadable profiles (cached null — private, deleted, or fetch error) as the real "Privat användare" fallback row, never dropped', () => {
    const cache = new Map<string, FollowProfile>([['p', null]]);
    const rows = resolveFollowRows(['p'], cache);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(followFallback('p'));
    expect(rows[0].displayName).toBe('Privat användare');
  });

  it('renders not-yet-fetched uids (cache miss) as a fallback row', () => {
    const rows = resolveFollowRows(['x'], new Map());
    expect(rows).toEqual([followFallback('x')]);
  });

  it('preserves order and row count across a mix of resolved, unreadable and unfetched (count matches the follow list)', () => {
    const cache = new Map<string, FollowProfile>([
      ['a', alice],
      ['p', null],
    ]);
    const rows = resolveFollowRows(['p', 'a', 'u'], cache);
    expect(rows.map(r => r.uid)).toEqual(['p', 'a', 'u']); // nothing dropped, order kept
    expect(rows[0].displayName).toBe('Privat användare');
    expect(rows[1]).toEqual(alice);
    expect(rows[2]).toEqual(followFallback('u'));
  });
});

describe('followFallback', () => {
  it('is anonymous, private and keyed by uid (leaks nothing about the source profile)', () => {
    expect(followFallback('z')).toEqual({
      uid: 'z',
      displayName: 'Privat användare',
      username: null,
      photoURL: null,
      isPublic: false,
    });
  });
});
