import { describe, it, expect } from 'vitest';
import { topTitles, expiredInsightDocIds } from './rollup';

// topTitles takes the WatchlistLite shape; only tmdbId/mediaType/title matter here.
const wl = (tmdbId: number, title: string, mediaType = 'movie') =>
  ({ status: 'sedd', mediaType, rating: null, title, tmdbId, providers: [], genreIds: [] });

describe('topTitles', () => {
  it('counts occurrences per tmdbId and returns them sorted by count desc, capped', () => {
    const items = [
      wl(1, 'A'), wl(1, 'A'), wl(1, 'A'),   // 3
      wl(2, 'B', 'tv'), wl(2, 'B', 'tv'),    // 2
      wl(3, 'C'),                            // 1
    ];
    expect(topTitles(items, 2)).toEqual([
      { tmdbId: 1, mediaType: 'movie', title: 'A', count: 3 },
      { tmdbId: 2, mediaType: 'tv', title: 'B', count: 2 },
    ]);
  });

  it('carries the denormalized title + normalizes mediaType to movie/tv', () => {
    const [row] = topTitles([wl(9, 'X', 'something-weird')], 5);
    expect(row).toEqual({ tmdbId: 9, mediaType: 'movie', title: 'X', count: 1 }); // non-tv → movie
  });

  it('returns [] for no items', () => {
    expect(topTitles([], 10)).toEqual([]);
  });
});

describe('expiredInsightDocIds (BIN-326 retention)', () => {
  const today = '2026-06-29';

  it('flags dated docs older than the retention window, keeps recent ones', () => {
    const ids = ['daily', '2026-01-15', '2026-06-28', '2026-06-29'];
    // 90 days before 2026-06-29 ≈ 2026-03-31: Jan 15 is older (delete), Jun 28/29 newer (keep).
    expect(expiredInsightDocIds(ids, today, 90)).toEqual(['2026-01-15']);
  });

  it('never flags the live `daily` doc or any non-date id', () => {
    expect(expiredInsightDocIds(['daily', 'weekly', 'config'], today, 90)).toEqual([]);
  });

  it('keeps everything when retention is wide enough', () => {
    expect(expiredInsightDocIds(['2026-01-15', '2026-03-01'], today, 365)).toEqual([]);
  });

  it('uses a strict < cutoff (a doc exactly at the cutoff day is kept)', () => {
    // cutoff for retention 30 from 2026-06-29 = 2026-05-30; that exact day is kept, day before deleted.
    const ids = ['2026-05-29', '2026-05-30', '2026-05-31'];
    expect(expiredInsightDocIds(ids, today, 30)).toEqual(['2026-05-29']);
  });
});
