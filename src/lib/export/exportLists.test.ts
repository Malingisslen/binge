import { describe, it, expect } from 'vitest';
import { buildLetterboxdCsv, buildTraktExport } from './exportLists';

const item = (o: Partial<Parameters<typeof buildLetterboxdCsv>[0][number]>) => ({
  tmdbId: 1, mediaType: 'movie' as const, status: 'sedd' as const, rating: null, title: 'T', releaseYear: 2000, ...o,
});

describe('buildLetterboxdCsv', () => {
  it('lists only seen movies with rating, skipping shows and other statuses', () => {
    const csv = buildLetterboxdCsv([
      item({ tmdbId: 603, title: 'The Matrix', releaseYear: 1999, rating: 4.5 }),
      item({ tmdbId: 2, mediaType: 'tv' }),
      item({ tmdbId: 3, status: 'vill_se' }),
    ], 'watched');
    expect(csv).toBe('tmdbID,Title,Year,Rating\n603,The Matrix,1999,4.5\n');
  });
  it('quotes titles with commas and quotes', () => {
    const csv = buildLetterboxdCsv([item({ title: 'Hello, "World"' })], 'watched');
    expect(csv).toContain('"Hello, ""World"""');
  });
  it('neutralises titles that a spreadsheet would run as a formula', () => {
    const csv = buildLetterboxdCsv([item({ title: '=HYPERLINK("x")' })], 'watched');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
  it('watchlist has no rating column', () => {
    const csv = buildLetterboxdCsv([item({ status: 'vill_se', tmdbId: 7 }), item({ tmdbId: 8 })], 'watchlist');
    expect(csv).toBe('tmdbID,Title,Year\n7,T,2000\n');
  });
});

describe('buildTraktExport', () => {
  it('splits history, ratings (×2) and watchlist; shows never go to history', () => {
    const t = buildTraktExport([
      item({ tmdbId: 1, rating: 4.5 }),
      item({ tmdbId: 2, status: 'vill_se' }),
      item({ tmdbId: 3, mediaType: 'tv', status: 'mina', rating: 3 }),
      item({ tmdbId: 4, mediaType: 'tv', status: 'mina' }),
    ]);
    expect(t.history.movies).toEqual([{ ids: { tmdb: 1 } }]);
    expect(t.history.shows).toEqual([]);
    expect(t.watchlist.movies).toEqual([{ ids: { tmdb: 2 } }]);
    expect(t.ratings.movies).toEqual([{ ids: { tmdb: 1 }, rating: 9 }]);
    expect(t.ratings.shows).toEqual([{ ids: { tmdb: 3 }, rating: 6 }]);
  });
});
