import { describe, it, expect } from 'vitest';
import { resolveFollowRows, followFallback, type FollowProfile, type FollowListUser } from './useFollowList.helpers';

const alice: FollowListUser = { uid: 'a', displayName: 'Alice', username: 'alice', photoURL: null, isPublic: true };

describe('resolveFollowRows', () => {
  it('includes resolved profiles in order', () => {
    const cache = new Map<string, FollowProfile>([['a', alice]]);
    expect(resolveFollowRows(['a'], cache)).toEqual([alice]);
  });

  it('drops ghost uids (deleted accounts whose profile doc is gone) — BIN-21', () => {
    const cache = new Map<string, FollowProfile>([['a', alice], ['ghost1', 'ghost']]);
    const rows = resolveFollowRows(['a', 'ghost1'], cache);
    expect(rows.map(r => r.uid)).toEqual(['a']);
  });

  it('renders private profiles (cached null) as a fallback row, NOT dropped', () => {
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

  it('preserves order across a mix of resolved, ghost, private and unfetched', () => {
    const cache = new Map<string, FollowProfile>([
      ['a', alice],
      ['g', 'ghost'],
      ['p', null],
    ]);
    const rows = resolveFollowRows(['a', 'g', 'p', 'u'], cache);
    expect(rows.map(r => r.uid)).toEqual(['a', 'p', 'u']); // 'g' dropped, order kept
  });

  it('drops all rows when every uid is a ghost', () => {
    const cache = new Map<string, FollowProfile>([['g1', 'ghost'], ['g2', 'ghost']]);
    expect(resolveFollowRows(['g1', 'g2'], cache)).toEqual([]);
  });
});
