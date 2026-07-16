import { describe, it, expect } from 'vitest';
import { rollupServiceValue, attributeProvider, watchedForValueFromItems, tvActiveProviderIdsFromItems } from './serviceValue';
import type { WatchedForValue } from './serviceValue';
import type { WatchlistItem } from '@/types';

const monthStart = Date.parse('2026-06-01T00:00:00');
const monthEnd = Date.parse('2026-07-01T00:00:00');
const inJune = Date.parse('2026-06-15T20:00:00');

// Viaplay 76 = 699, Max 384 = 109 (the ticket's example costs).
const costFor = (id: number) => ({ 76: 699, 384: 109 }[id] ?? 0);

const w = (providerId: number, runtimeMinutes: number | null, watchedAtMs = inJune): WatchedForValue =>
  ({ providerId, runtimeMinutes, watchedAtMs });

describe('attributeProvider', () => {
  it('credits a title to the only owned service that carries it', () => {
    expect(attributeProvider([76, 8], [76])).toBe(76);
  });
  it('multi-owned → deterministic lowest canonical id', () => {
    expect(attributeProvider([384, 76], [76, 384])).toBe(76);
  });
  it('resolves aliases before matching (TV4 Play 1944 → 489)', () => {
    expect(attributeProvider([1944], [489])).toBe(489);
  });
  it('returns null when the user owns none of the services', () => {
    expect(attributeProvider([8, 119], [76])).toBeNull();
  });
});

describe('rollupServiceValue', () => {
  it('computes kr-per-title and kr-per-hour per service', () => {
    const rows = rollupServiceValue({
      watched: [w(76, 50)], // Viaplay: 1 episode, 50 min
      ownedProviderIds: [76],
      costFor, monthStartMs: monthStart, monthEndMs: monthEnd,
    });
    const via = rows.find((r) => r.providerId === 76)!;
    expect(via.titlesWatched).toBe(1);
    expect(via.krPerTitle).toBe(699);
    expect(via.krPerHour).toBe(Math.round(699 / (50 / 60))); // ≈839
  });

  it('Max watched 14h across titles → ≈8 kr/h', () => {
    const watched = Array.from({ length: 14 }, () => w(384, 60)); // 14 × 60 min = 14h
    const rows = rollupServiceValue({
      watched, ownedProviderIds: [384], costFor, monthStartMs: monthStart, monthEndMs: monthEnd,
    });
    const max = rows.find((r) => r.providerId === 384)!;
    expect(max.titlesWatched).toBe(14);
    expect(max.minutesWatched).toBe(14 * 60);
    expect(max.krPerHour).toBe(Math.round(109 / 14)); // ≈8
  });

  it('flags a paid service with zero watched titles as dead-weight', () => {
    const rows = rollupServiceValue({
      watched: [w(384, 60)],
      ownedProviderIds: [76, 384],
      costFor, monthStartMs: monthStart, monthEndMs: monthEnd,
    });
    const via = rows.find((r) => r.providerId === 76)!;
    expect(via.titlesWatched).toBe(0);
    expect(via.isDeadWeight).toBe(true);
    expect(via.krPerTitle).toBeNull();
    expect(via.krPerHour).toBeNull();
  });

  it('does NOT flag a TV-only service as dead-weight (BIN-513)', () => {
    // Viaplay carries no film watched this month, but the user actively follows
    // a series on it — the films-only lens must not read that as wasted spend.
    const rows = rollupServiceValue({
      watched: [w(384, 60)],
      ownedProviderIds: [76, 384],
      costFor, monthStartMs: monthStart, monthEndMs: monthEnd,
      tvActiveProviderIds: [76],
    });
    const via = rows.find((r) => r.providerId === 76)!;
    expect(via.titlesWatched).toBe(0);
    expect(via.isDeadWeight).toBe(false);
  });

  it('still flags a genuinely unused paid service even when TV-guard is present', () => {
    const rows = rollupServiceValue({
      watched: [w(384, 60)],
      ownedProviderIds: [76, 384],
      costFor, monthStartMs: monthStart, monthEndMs: monthEnd,
      tvActiveProviderIds: [384], // guard names a DIFFERENT service
    });
    const via = rows.find((r) => r.providerId === 76)!;
    expect(via.isDeadWeight).toBe(true);
  });

  it('resolves alias ids in the TV-guard before matching (TV4 Play 1944 → 489)', () => {
    const rows = rollupServiceValue({
      watched: [],
      ownedProviderIds: [489],
      costFor: (id) => (id === 489 ? 109 : 0),
      monthStartMs: monthStart, monthEndMs: monthEnd,
      tvActiveProviderIds: [1944], // alias of 489
    });
    expect(rows.find((r) => r.providerId === 489)!.isDeadWeight).toBe(false);
  });

  it('excludes titles watched outside the month window', () => {
    const may = Date.parse('2026-05-20T12:00:00');
    const rows = rollupServiceValue({
      watched: [w(76, 60, may)],
      ownedProviderIds: [76], costFor, monthStartMs: monthStart, monthEndMs: monthEnd,
    });
    expect(rows[0].titlesWatched).toBe(0);
  });

  it('counts an unknown-runtime title toward the tally but not the hours', () => {
    const rows = rollupServiceValue({
      watched: [w(76, null)],
      ownedProviderIds: [76], costFor, monthStartMs: monthStart, monthEndMs: monthEnd,
    });
    expect(rows[0].titlesWatched).toBe(1);
    expect(rows[0].minutesWatched).toBe(0);
    expect(rows[0].krPerHour).toBeNull();
    expect(rows[0].krPerTitle).toBe(699);
  });

  it('does not count watches attributed to a non-owned service', () => {
    const rows = rollupServiceValue({
      watched: [w(8, 60)], // Netflix, not owned
      ownedProviderIds: [76], costFor, monthStartMs: monthStart, monthEndMs: monthEnd,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].titlesWatched).toBe(0);
  });
});

describe('tvActiveProviderIdsFromItems (BIN-513)', () => {
  // Minimal-but-complete WatchlistItem; override only the fields the guard reads.
  const tv = (o: Partial<WatchlistItem>): WatchlistItem => ({
    tmdbId: 1, mediaType: 'tv', status: 'mina', rating: null, notes: null,
    title: 'Show', posterPath: null, releaseYear: null,
    totalSeasons: null, lastWatchedSeason: null, lastWatchedEpisode: null,
    dropped: false, rewatchCount: 0, providers: [76], providersCheckedAt: null,
    visibility: null, genreIds: [], tmdbStatus: null,
    addedAt: new Date(0), updatedAt: new Date(0), watchedAt: null, ...o,
  });

  it('EXCLUDES a finished Ended+caught-up series (avslutad) — it must stay dead-weight-eligible', () => {
    const ids = tvActiveProviderIdsFromItems([
      tv({ tmdbStatus: 'Ended', totalSeasons: 3, lastWatchedSeason: 3, providers: [76] }),
    ]);
    expect(ids).not.toContain(76);
    expect(ids).toHaveLength(0);
  });

  it('INCLUDES a followed-but-unstarted series (ej_paborjad)', () => {
    const ids = tvActiveProviderIdsFromItems([tv({ lastWatchedSeason: null, providers: [76] })]);
    expect(ids).toContain(76);
  });

  it('INCLUDES a behind-on-aired ended series (ligger_efter)', () => {
    const ids = tvActiveProviderIdsFromItems([
      tv({ tmdbStatus: 'Ended', totalSeasons: 3, lastWatchedSeason: 1, providers: [384] }),
    ]);
    expect(ids).toContain(384);
  });

  it('INCLUDES an in-progress ongoing series (paborjad)', () => {
    const ids = tvActiveProviderIdsFromItems([
      tv({ tmdbStatus: 'Returning Series', totalSeasons: 2, lastWatchedSeason: 1, providers: [8] }),
    ]);
    expect(ids).toContain(8);
  });

  it('INCLUDES a TV will-see anchor (vill_se)', () => {
    const ids = tvActiveProviderIdsFromItems([tv({ status: 'vill_se', providers: [119] })]);
    expect(ids).toContain(119);
  });

  it('ignores films entirely', () => {
    // status 'vill_se' would pass the status guard, so only the mediaType check
    // can exclude it — makes this a real test of the film/TV guard.
    const ids = tvActiveProviderIdsFromItems([tv({ mediaType: 'movie', status: 'vill_se', providers: [76] })]);
    expect(ids).toHaveLength(0);
  });

  it('regression: a service whose only title is an avslutad series IS flagged dead weight', () => {
    const items = [tv({ tmdbStatus: 'Ended', totalSeasons: 2, lastWatchedSeason: 2, providers: [76] })];
    const rows = rollupServiceValue({
      watched: [], // no film watched this month
      ownedProviderIds: [76],
      costFor: (id) => (id === 76 ? 699 : 0),
      monthStartMs: monthStart, monthEndMs: monthEnd,
      tvActiveProviderIds: tvActiveProviderIdsFromItems(items),
    });
    expect(rows.find((r) => r.providerId === 76)!.isDeadWeight).toBe(true);
  });
});

describe('watchedForValueFromItems', () => {
  const item = (o: Partial<{ providers: number[]; runtime: number | null; watchedAt: Date | null }>) => ({
    providers: [76], runtime: 100, watchedAt: new Date(inJune), ...o,
  });

  it('includes films watched in the window, attributed to an owned service', () => {
    const out = watchedForValueFromItems([item({})], [76], monthStart, monthEnd);
    expect(out).toEqual([{ providerId: 76, runtimeMinutes: 100, watchedAtMs: inJune }]);
  });

  it('skips items with no watchedAt', () => {
    expect(watchedForValueFromItems([item({ watchedAt: null })], [76], monthStart, monthEnd)).toHaveLength(0);
  });

  it('skips items watched outside the month', () => {
    const may = new Date(Date.parse('2026-05-20T12:00:00'));
    expect(watchedForValueFromItems([item({ watchedAt: may })], [76], monthStart, monthEnd)).toHaveLength(0);
  });

  it('skips items not on an owned service', () => {
    expect(watchedForValueFromItems([item({ providers: [8] })], [76], monthStart, monthEnd)).toHaveLength(0);
  });

  it('passes through null runtime', () => {
    const out = watchedForValueFromItems([item({ runtime: null })], [76], monthStart, monthEnd);
    expect(out[0].runtimeMinutes).toBeNull();
  });
});
