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

describe('buildTasteVector — mina viktas på progress', () => {
  it('ej påbörjad mina-serie väger som planerad (0.25), påbörjad som samling (0.75)', () => {
    const unstarted = buildTasteVector([
      mkItem({ status: 'mina', mediaType: 'tv', lastWatchedSeason: null, genreIds: [18] }),
    ]);
    expect(unstarted.genres[18]).toBe(0.25);
    const started = buildTasteVector([
      mkItem({ status: 'mina', mediaType: 'tv', lastWatchedSeason: 1, lastWatchedEpisode: 2, genreIds: [18] }),
    ]);
    expect(started.genres[18]).toBe(0.75);
  });
});

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

  // BIN-318 (#28-ruling, ADR 0003): detta test hävdade tidigare att "rating
  // vinner" för avbrutna titlar — det kodade en bugg (ett 2★-avhopp fick POSITIV
  // vikt) och använde dessutom off-scale-data (rating: 8, max är 5). Korrekt
  // regel: avhopp är avgörande. Högt betyg (≥4 på 0.5–5-skalan) före avhopp =
  // du gillade genren, bailade bara på titeln → neutral (0). Lågt/oratat avhopp
  // → -0.5 (dubbel-negativt).
  it('avbruten med HÖGT betyg (≥4) blir neutral (0) och räknas inte i sampleSize', () => {
    const v = buildTasteVector([
      mkItem({ status: 'avbruten', rating: 4.5, genreIds: [18] }),
    ]);
    expect(v.genres[18]).toBeUndefined(); // w===0 → genren rörs aldrig
    expect(v.sampleSize).toBe(0);
  });

  it('avbruten med LÅGT betyg (<4) får -0.5 (dubbel-negativt, inte positiv rating-vikt)', () => {
    const v = buildTasteVector([
      mkItem({ status: 'avbruten', rating: 1.5, genreIds: [18] }),
    ]);
    expect(v.genres[18]).toBe(-0.5);
    expect(v.sampleSize).toBe(1);
  });

  it('tröskeln är inklusiv: exakt betyg 4 räknas som högt (neutral 0)', () => {
    // Vaktar off-by-one: >=4 vs >4. rating 4 → neutral, inte -0.5.
    const v = buildTasteVector([
      mkItem({ status: 'avbruten', rating: 4, genreIds: [18] }),
    ]);
    expect(v.genres[18]).toBeUndefined();
    expect(v.sampleSize).toBe(0);
  });
});
