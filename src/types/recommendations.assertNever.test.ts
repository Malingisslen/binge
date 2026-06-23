import { describe, it, expect } from 'vitest';
import { rowKey, type RowId } from './recommendations';
describe('rowKey exhaustiveness', () => {
  it('produces stable keys for every known kind', () => {
    expect(rowKey({ kind: 'similar', mediaType: 'movie', tmdbId: 603 })).toBe('similar:movie:603');
    expect(rowKey({ kind: 'person', personId: 140607 })).toBe('person:140607');
    expect(rowKey({ kind: 'genre-canon', genreId: 18 })).toBe('genre:18');
    expect(rowKey({ kind: 'thematic', keywordId: 9663 })).toBe('keyword:9663');
    expect(rowKey({ kind: 'trending' })).toBe('trending');
    expect(rowKey({ kind: 'latest-fav' })).toBe('latest-fav');
    expect(rowKey({ kind: 'upcoming' })).toBe('upcoming');
    expect(rowKey({ kind: 'free-public' })).toBe('free-public');
  });
  it('throws via assertNever for an unknown kind', () => {
    const bogus = { kind: 'does-not-exist' } as unknown as RowId;
    expect(() => rowKey(bogus)).toThrow(/assertNever/);
  });
});
