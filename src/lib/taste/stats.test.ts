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
