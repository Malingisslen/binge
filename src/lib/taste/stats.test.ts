import { describe, it, expect } from 'vitest';
import { computeProfileStats } from './stats';
import type { WatchlistItem } from '@/types';

function mkItem(overrides: Partial<WatchlistItem>): WatchlistItem {
  return {
    tmdbId: 1,
    mediaType: 'movie',
    status: 'sedd',
    rating: null,
    notes: null,
    title: 'Test',
    posterPath: null,
    releaseYear: 2020,
    totalSeasons: null,
    lastWatchedSeason: null,
    lastWatchedEpisode: null,
    dropped: false,
    rewatchCount: 0,
    providers: [],
    providersCheckedAt: null,
    visibility: null,
    genreIds: [18],
    tmdbStatus: null,
    addedAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    watchedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('computeProfileStats — avbruten ger 0 vikt', () => {
  it('avbruten utan rating bidrar inte till genre-vikt', () => {
    const stats = computeProfileStats([
      mkItem({ status: 'avbruten', rating: null, genreIds: [18] }),
    ]);
    const g = stats.topGenres.find(t => t.genreId === 18);
    // count räknas fortfarande (titeln finns), men weight ska vara 0.
    expect(g?.count).toBe(1);
    expect(g?.weight).toBe(0);
  });

  it('ignorerar den döda dropped-flaggan — status styr vikten', () => {
    // Tidigare bug: item.dropped (alltid false) → avbrutna fick 'sedd'-vikt.
    const stats = computeProfileStats([
      mkItem({ status: 'sedd', rating: null, genreIds: [18] }),
    ]);
    const g = stats.topGenres.find(t => t.genreId === 18);
    expect(g?.weight).toBe(0.8); // 'sedd' positiv vikt, inte 0
  });

  it('avbruten med rating använder rating-vikten', () => {
    const stats = computeProfileStats([
      mkItem({ status: 'avbruten', rating: 8, genreIds: [18] }),
    ]);
    const g = stats.topGenres.find(t => t.genreId === 18);
    expect(g?.weight).toBe(8 / 10);
  });
});

describe('computeProfileStats — recent30 30-dagarsfönster (BIN-339)', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  it('räknar bara titlar vars datum ligger inom 30 dagar', () => {
    const stats = computeProfileStats([
      // Allt inom fönstret → bidrar till alla tre räknarna.
      mkItem({ tmdbId: 1, watchedAt: daysAgo(5), addedAt: daysAgo(5), updatedAt: daysAgo(5), rating: 8 }),
      // Allt utanför fönstret → bidrar till inget.
      mkItem({ tmdbId: 2, watchedAt: daysAgo(40), addedAt: daysAgo(40), updatedAt: daysAgo(40), rating: 8 }),
    ]);
    expect(stats.recent30).toEqual({ watched: 1, added: 1, rated: 1 });
  });

  it('rated kräver BÅDE en rating OCH en färsk updatedAt; null watchedAt räknas inte', () => {
    const stats = computeProfileStats([
      // Ingen rating → ej rated, även om updatedAt är färsk.
      mkItem({ tmdbId: 1, rating: null, updatedAt: daysAgo(1), watchedAt: null, addedAt: daysAgo(100) }),
      // Rating + färsk updatedAt → rated.
      mkItem({ tmdbId: 2, rating: 9, updatedAt: daysAgo(1), watchedAt: null, addedAt: daysAgo(100) }),
      // Rating men gammal updatedAt → ej rated (betyget sattes inte nyligen).
      mkItem({ tmdbId: 3, rating: 9, updatedAt: daysAgo(60), watchedAt: null, addedAt: daysAgo(100) }),
    ]);
    expect(stats.recent30.rated).toBe(1);
    expect(stats.recent30.watched).toBe(0); // watchedAt null på alla → 0
    expect(stats.recent30.added).toBe(0);   // addedAt 100 dagar bort → 0
  });
});
