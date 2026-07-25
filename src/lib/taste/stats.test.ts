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

describe('computeProfileStats — genre-vikt', () => {
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

  it('en ratad avbruten titel förblir neutral — avbruten kollas före rating (BIN-511)', () => {
    // Gav du upp titeln ska den inte dra upp genren, även om du hann sätta ett
    // betyg. (Tidigare kom rating-grenen först → ratade avhopp drog upp genren.)
    const stats = computeProfileStats([
      mkItem({ status: 'avbruten', rating: 4, genreIds: [18] }),
    ]);
    const g = stats.topGenres.find(t => t.genreId === 18);
    expect(g?.weight).toBe(0);
  });

  it('normaliserar betyg på 0.5–5-skalan (rating/5), inte 0–10 (BIN-511)', () => {
    // Topp-betyg 5 → vikt 1.0. Gamla /10-buggen gav 0.5 — lägre än ett osett
    // 'sedd'-item (0.8), så en 5★-titel vägde mindre än en obetygsatt.
    const top = computeProfileStats([mkItem({ status: 'sedd', rating: 5, genreIds: [18] })]);
    expect(top.topGenres.find(t => t.genreId === 18)?.weight).toBe(1);
    // Halva skalan (2.5) → 0.5.
    const mid = computeProfileStats([mkItem({ status: 'sedd', rating: 2.5, genreIds: [12] })]);
    expect(mid.topGenres.find(t => t.genreId === 12)?.weight).toBe(0.5);
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

  // BIN-593: watchedAt rensas inte längre när en titel lämnar 'sedd', så ett bart
  // datum-filter räknade avbrutna/omlagda filmer som sedda på den PUBLIKA profilen.
  // mkItem defaultar till status 'sedd', så fixturen MÅSTE variera statusen — annars
  // hade testet varit grönt både med och utan grinden.
  it('BIN-593: räknar bara titlar som FAKTISKT står som sedda, inte bara har ett sett-datum', () => {
    const stats = computeProfileStats([
      // Sedd + färskt datum → räknas.
      mkItem({ tmdbId: 1, status: 'sedd', watchedAt: daysAgo(3), addedAt: daysAgo(100) }),
      // Sedd i förrgår, sedan avbruten. Datumet ligger kvar — men den är inte sedd.
      mkItem({ tmdbId: 2, status: 'avbruten', watchedAt: daysAgo(2), addedAt: daysAgo(100) }),
      // Samma sak för en titel som lagts tillbaka i "vill se".
      mkItem({ tmdbId: 3, status: 'vill_se', watchedAt: daysAgo(1), addedAt: daysAgo(100) }),
    ]);
    expect(stats.recent30.watched).toBe(1);
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

  // Distinguishing case: a SINGLE item where old (updatedAt) and new (ratedAt)
  // anchors DISAGREE, so the assertion fails against the old implementation.
  it('does NOT count a rating set long ago even when the row was edited recently (BIN-349)', () => {
    const stats = computeProfileStats([
      // Betygsatt för 60 dagar sedan men redigerad igår (färsk updatedAt).
      // Gamla updatedAt-ankaret räknade detta som rated=1; ratedAt ger rätt 0.
      mkItem({ tmdbId: 1, rating: 9, ratedAt: daysAgo(60), updatedAt: daysAgo(1), watchedAt: null, addedAt: daysAgo(100) }),
    ]);
    expect(stats.recent30.rated).toBe(0);
  });

  it('counts a recently-rated title even when the row is otherwise old (BIN-349)', () => {
    const stats = computeProfileStats([
      // Betygsatt för 2 dagar sedan men gammal updatedAt (80d). Gamla ankaret
      // MISSADE detta (rated=0); ratedAt räknar det rätt (rated=1).
      mkItem({ tmdbId: 1, rating: 9, ratedAt: daysAgo(2), updatedAt: daysAgo(80), watchedAt: null, addedAt: daysAgo(100) }),
    ]);
    expect(stats.recent30.rated).toBe(1);
  });

  it('falls back to updatedAt for items without ratedAt (lazy migration, BIN-349)', () => {
    const stats = computeProfileStats([
      mkItem({ tmdbId: 1, rating: 9, updatedAt: daysAgo(3), watchedAt: null, addedAt: daysAgo(100) }), // no ratedAt
    ]);
    expect(stats.recent30.rated).toBe(1);
  });
});
