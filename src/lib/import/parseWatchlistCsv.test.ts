import { describe, it, expect } from 'vitest';
import { parseCsvLine, parseWatchlistCsv } from './parseWatchlistCsv';

describe('parseCsvLine', () => {
  it('splits plain comma-separated fields and trims', () => {
    expect(parseCsvLine('a, b ,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps commas inside double-quoted fields', () => {
    expect(parseCsvLine('"Lock, Stock",1998,5')).toEqual(['Lock, Stock', '1998', '5']);
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    expect(parseCsvLine('"She said ""hi""",2020')).toEqual(['She said "hi"', '2020']);
  });
});

describe('parseWatchlistCsv — Letterboxd', () => {
  const csv = [
    'Date,Name,Year,Letterboxd URI,Rating',
    '2024-01-02,Parasite,2019,https://boxd.it/x,4.5',
    '2024-01-03,"Lock, Stock and Two Smoking Barrels",1998,https://boxd.it/y,',
  ].join('\n');

  it('detects the format and parses rows', () => {
    const res = parseWatchlistCsv(csv);
    expect(res.format).toBe('letterboxd');
    expect(res.rows).toHaveLength(2);
  });

  it('stores Letterboxd 0.5–5 stars as-is (same scale as Binge, no ×2)', () => {
    const res = parseWatchlistCsv(csv);
    expect(res.rows[0]).toMatchObject({ title: 'Parasite', year: 2019, rating: 4.5 });
  });

  it('handles a quoted title with a comma and a missing rating', () => {
    const res = parseWatchlistCsv(csv);
    expect(res.rows[1]).toMatchObject({
      title: 'Lock, Stock and Two Smoking Barrels',
      year: 1998,
      rating: null,
      mediaTypeHint: null,
    });
  });
});

describe('parseWatchlistCsv — IMDb', () => {
  const csv = [
    'Const,Your Rating,Date Rated,Title,Title Type,IMDb Rating,Year',
    'tt0111161,10,2023-05-01,The Shawshank Redemption,movie,9.3,1994',
    'tt0903747,9,2023-06-01,Breaking Bad,tvSeries,9.5,2008',
  ].join('\n');

  it('detects IMDb and carries the tt-id + media-type hint', () => {
    const res = parseWatchlistCsv(csv);
    expect(res.format).toBe('imdb');
    expect(res.rows[0]).toMatchObject({
      title: 'The Shawshank Redemption', year: 1994, rating: 5, imdbId: 'tt0111161', mediaTypeHint: 'movie',
    });
    expect(res.rows[1]).toMatchObject({ imdbId: 'tt0903747', mediaTypeHint: 'tv', rating: 4.5 });
  });

  // BIN-340: IMDb 'Your Rating' is 1–10 → Binge stores 0.5–5 (÷2). The boundaries
  // are where the watchlist-vs-review scale conflation (BIN-69/BIN-143) bites — a
  // mis-handled boundary silently corrupts a whole library on first import.
  it('maps IMDb rating boundaries to null/0.5 without writing a bad value', () => {
    const boundary = [
      'Const,Your Rating,Date Rated,Title,Title Type,IMDb Rating,Year',
      'tt1,0,2023-05-01,Cleared Rating,movie,9.3,1994',   // IMDb exports 0 for rated-then-cleared
      'tt2,,2023-05-01,Empty Rating,movie,9.3,1994',       // blank → NaN
      'tt3,11,2023-05-01,Corrupt Rating,movie,9.3,1994',   // out-of-range / future schema
      'tt4,1,2023-05-01,Lowest Valid,movie,9.3,1994',      // lower valid boundary → 0.5
    ].join('\n');
    const res = parseWatchlistCsv(boundary);
    expect(res.rows[0].rating).toBeNull(); // 0 → null
    expect(res.rows[1].rating).toBeNull(); // "" → null
    expect(res.rows[2].rating).toBeNull(); // 11 → null
    expect(res.rows[3].rating).toBe(0.5);  // 1 → 0.5
  });
});

describe('parseWatchlistCsv — edge cases', () => {
  it('returns unknown for an unrecognised header', () => {
    const res = parseWatchlistCsv('foo,bar\n1,2');
    expect(res.format).toBe('unknown');
    expect(res.rows).toEqual([]);
  });

  it('counts rows with no title as skipped, not as bad rows', () => {
    const csv = 'Date,Name,Year,Letterboxd URI\n2024-01-01,,2020,uri\n2024-01-02,Dune,2021,uri';
    const res = parseWatchlistCsv(csv);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].title).toBe('Dune');
    expect(res.skipped).toBe(1);
  });

  it('returns empty for header-only or empty input', () => {
    expect(parseWatchlistCsv('').rows).toEqual([]);
    expect(parseWatchlistCsv('Const,Title').rows).toEqual([]);
  });

  it('rejects an implausible year', () => {
    const res = parseWatchlistCsv('Name,Year,Letterboxd URI\nFoo,99,uri');
    expect(res.rows[0].year).toBeNull();
  });

  it('only treats a tt-prefixed Const as an imdbId', () => {
    const csv = 'Const,Title,Title Type,Year\nnm0000001,Some Person,movie,2000';
    const res = parseWatchlistCsv(csv);
    expect(res.rows[0].imdbId).toBeNull();
  });

  it('detects Letterboxd-ratings export with no URI column (Name+Year+Rating)', () => {
    const res = parseWatchlistCsv('Name,Year,Rating\nDune,2021,5');
    expect(res.format).toBe('letterboxd');
    expect(res.rows[0]).toMatchObject({ title: 'Dune', year: 2021, rating: 5 });
  });

  it('keeps the lower-boundary 0.5-star Letterboxd rating', () => {
    const res = parseWatchlistCsv('Name,Year,Rating\nTitle,2020,0.5');
    expect(res.rows[0].rating).toBe(0.5);
  });

  // BIN-340: detectFormat is intentionally loose — any header with name+year (and
  // no Const/Letterboxd marker) is treated as a Letterboxd ratings export. Pin that
  // boundary so a future tightening is a conscious, reviewed change rather than a
  // silent regression. (A near-miss like a contacts export with name,year is the
  // known cost of this looseness.)
  it('classifies a bare name+year header as Letterboxd (documented loose boundary)', () => {
    const res = parseWatchlistCsv('Name,Year\nDune,2021');
    expect(res.format).toBe('letterboxd');
    expect(res.rows[0]).toMatchObject({ title: 'Dune', year: 2021, rating: null });
  });

  it('does NOT classify a header lacking both name and const as a known format', () => {
    expect(parseWatchlistCsv('email,phone\na@b.c,123').format).toBe('unknown');
  });
});
