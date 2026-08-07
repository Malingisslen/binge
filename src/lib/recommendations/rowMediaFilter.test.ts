import { describe, it, expect } from 'vitest';
import { rowMatchesMediaFilter } from './rowMediaFilter';
import { rowKey } from '@/types';
import type { RowId, RowSpec } from '@/types';

function spec(id: RowId): RowSpec {
  return { id, rowKey: rowKey(id), label: 'rad', score: 1, jtbd: 'C' };
}

describe('rowMatchesMediaFilter', () => {
  it('keeps every row under the "Alla" tab', () => {
    const ids: RowId[] = [
      { kind: 'trending' },
      { kind: 'companion' },
      { kind: 'similar', mediaType: 'tv', tmdbId: 1396 },
      { kind: 'latest-fav' },
    ];
    for (const id of ids) expect(rowMatchesMediaFilter(spec(id), 'all', null)).toBe(true);
  });

  it('locks a similar row to its seed media type', () => {
    const s = spec({ kind: 'similar', mediaType: 'tv', tmdbId: 1396 });
    expect(rowMatchesMediaFilter(s, 'tv', null)).toBe(true);
    expect(rowMatchesMediaFilter(s, 'movie', null)).toBe(false);
  });

  it('locks latest-fav to the 5★ seed media type', () => {
    const s = spec({ kind: 'latest-fav' });
    expect(rowMatchesMediaFilter(s, 'movie', { mediaType: 'movie' })).toBe(true);
    expect(rowMatchesMediaFilter(s, 'tv', { mediaType: 'movie' })).toBe(false);
    expect(rowMatchesMediaFilter(s, 'tv', null)).toBe(false);
  });

  it('BIN-583: the companion row follows its FILM payload, not its TV anchor', () => {
    const s = spec({ kind: 'companion' });
    // Anchored on followed series, but every title it shows is a film.
    expect(rowMatchesMediaFilter(s, 'movie', null)).toBe(true);
    expect(rowMatchesMediaFilter(s, 'tv', null)).toBe(false);
    // ...and the anchor's own media type must not sway it.
    expect(rowMatchesMediaFilter(s, 'tv', { mediaType: 'tv' })).toBe(false);
  });

  it('leaves self-filtering rows alone', () => {
    for (const id of [
      { kind: 'trending' },
      { kind: 'person', personId: 1 },
      { kind: 'genre-canon', genreId: 18 },
      { kind: 'thematic', keywordId: 9 },
      { kind: 'upcoming' },
      { kind: 'free-public' },
    ] as RowId[]) {
      expect(rowMatchesMediaFilter(spec(id), 'tv', null)).toBe(true);
      expect(rowMatchesMediaFilter(spec(id), 'movie', null)).toBe(true);
    }
  });
});
