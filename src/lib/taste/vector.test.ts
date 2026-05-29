import { describe, it, expect } from 'vitest';
import { buildTasteVector } from './vector';
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

describe('buildTasteVector — avbruten negativ smaksignal', () => {
  it('viktar avbruten utan rating negativt (-0.5)', () => {
    const v = buildTasteVector([
      mkItem({ status: 'avbruten', rating: null, genreIds: [18] }),
    ]);
    expect(v.genres[18]).toBe(-0.5);
    expect(v.sampleSize).toBe(1);
  });

  it('ignorerar den döda dropped-flaggan (alltid false) — status styr', () => {
    // Tidigare bug: koden läste item.dropped som alltid är false (deprecated),
    // så avbrutna titlar fick samma vikt som 'sedd'. Nu styr status.
    const seenLikeBug = mkItem({ status: 'sedd', rating: null, genreIds: [18] });
    const v = buildTasteVector([seenLikeBug]);
    expect(v.genres[18]).toBe(1); // 'sedd' positiv, inte negativ
  });

  it('avbruten med rating använder rating-vikten (rating vinner)', () => {
    const v = buildTasteVector([
      mkItem({ status: 'avbruten', rating: 8, genreIds: [18] }),
    ]);
    expect(v.genres[18]).toBe((8 / 10) * 2);
  });
});
