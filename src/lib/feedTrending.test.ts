import { describe, it, expect } from 'vitest';
import { computeFollowTrending, type TrendingInput } from './feedTrending';

const wl = (uid: string, displayName: string, tmdbId: number, title: string, posterPath: string | null = null): TrendingInput =>
  ({ kind: 'watchlist', uid, displayName, tmdbId, title, mediaType: 'tv', posterPath });

describe('computeFollowTrending (BIN-101)', () => {
  it('counts DISTINCT followed users per title, ranked desc', () => {
    const items = [
      wl('a', 'Anna', 1, 'Severance'),
      wl('b', 'Bo', 1, 'Severance'),
      wl('c', 'Cilla', 1, 'Severance'),  // Severance → 3 distinct
      wl('a', 'Anna', 2, 'The Bear'),
      wl('b', 'Bo', 2, 'The Bear'),       // The Bear → 2 distinct
    ];
    const out = computeFollowTrending(items);
    expect(out.map(t => [t.tmdbId, t.followerCount])).toEqual([[1, 3], [2, 2]]);
    expect(out[0].names).toEqual(['Anna', 'Bo', 'Cilla']);
  });

  it('dedupes a user adding/updating a title repeatedly (Set, not a cap)', () => {
    const items = [
      wl('a', 'Anna', 1, 'Severance'),
      wl('a', 'Anna', 1, 'Severance'),
      wl('a', 'Anna', 1, 'Severance'), // three times → still one distinct user
      wl('b', 'Bo', 1, 'Severance'),
    ];
    const out = computeFollowTrending(items);
    expect(out[0].followerCount).toBe(2);          // a cap-at-2 impl would also pass count...
    expect(out[0].names).toEqual(['Anna', 'Bo']);  // ...but would push 'Anna' twice → ['Anna','Anna','Bo']
  });

  it('breaks follower-count ties by Swedish title order', () => {
    const items = [
      wl('a', 'Anna', 1, 'Östen'),    // Ö sorts last in sv
      wl('b', 'Bo', 1, 'Östen'),
      wl('a', 'Anna', 2, 'Abba'),     // same count (2), A sorts first
      wl('b', 'Bo', 2, 'Abba'),
    ];
    const out = computeFollowTrending(items);
    expect(out.map(t => t.title)).toEqual(['Abba', 'Östen']); // tie → sv-alphabetical
  });

  it('hides titles below the min-followers threshold (default 2)', () => {
    const items = [wl('a', 'Anna', 1, 'Solo Pick')]; // only 1 follower
    expect(computeFollowTrending(items)).toEqual([]);
  });

  it('ignores non-watchlist items (e.g. reviews)', () => {
    const items: TrendingInput[] = [
      wl('a', 'Anna', 1, 'Severance'),
      { kind: 'review', uid: 'b', displayName: 'Bo', tmdbId: 1, title: 'Severance', mediaType: 'tv', posterPath: null },
    ];
    expect(computeFollowTrending(items)).toEqual([]); // only 1 watchlist add → below threshold
  });

  it('respects the limit', () => {
    const items: TrendingInput[] = [];
    for (let t = 1; t <= 10; t++) { items.push(wl('a', 'Anna', t, `T${t}`), wl('b', 'Bo', t, `T${t}`)); }
    expect(computeFollowTrending(items, 2, 3)).toHaveLength(3);
  });

  it('backfills a poster from a later item when the first lacked one', () => {
    const items = [
      wl('a', 'Anna', 1, 'Severance', null),
      wl('b', 'Bo', 1, 'Severance', '/poster.jpg'),
    ];
    expect(computeFollowTrending(items)[0].posterPath).toBe('/poster.jpg');
  });
});
