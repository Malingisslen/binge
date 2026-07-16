import { describe, it, expect } from 'vitest';
import { computeSpendSnapshot, isKeepReasonStatus } from './spendSnapshot';
import type { WatchlistItem } from '@/types';

const mk = (over: Partial<WatchlistItem>): WatchlistItem => ({
  tmdbId: 1, mediaType: 'movie', status: 'vill_se', rating: null, notes: null,
  title: 'X', posterPath: null, releaseYear: null, totalSeasons: null,
  lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false,
  rewatchCount: 0, providers: [], providersCheckedAt: null, visibility: null,
  genreIds: [], tmdbStatus: null,
  addedAt: new Date(), updatedAt: new Date(), watchedAt: null,
  ...over,
}) as WatchlistItem;

describe('isKeepReasonStatus (BIN-528 shared guard)', () => {
  // The one definition of "active reason to keep a service" shared by the
  // spend snapshot, household dead-weight, and service-value surfaces.
  it('counts vill_se (film backlog) and mina (followed series) as keep-reasons', () => {
    expect(isKeepReasonStatus('vill_se')).toBe(true);
    expect(isKeepReasonStatus('mina')).toBe(true);
  });
  it('never counts sedd or avbruten', () => {
    expect(isKeepReasonStatus('sedd')).toBe(false);
    expect(isKeepReasonStatus('avbruten')).toBe(false);
  });
});

describe('computeSpendSnapshot (BIN-99)', () => {
  it('splits owned spend into active vs idle by backlog availability', () => {
    // Netflix(8)=169 has a vill_se title; Viaplay(76)=169 has none → idle.
    const items = [mk({ tmdbId: 1, status: 'vill_se', providers: [8] })];
    const snap = computeSpendSnapshot([8, 76], items, {});
    expect(snap.totalKr).toBe(169 + 169);
    expect(snap.activeKr).toBe(169);
    expect(snap.idleKr).toBe(169);
    expect(snap.idleProviders.map(p => p.id)).toEqual([76]);
  });

  it('respects providerCosts overrides over defaults', () => {
    const snap = computeSpendSnapshot([8], [mk({ providers: [8] })], { 8: 99 });
    expect(snap.totalKr).toBe(99);
    expect(snap.activeKr).toBe(99);
  });

  it('BIN-417: applies an active campaign, then auto-reverts past its end date', () => {
    // Netflix (8) ordinary 169; a 29 kr campaign runs t.o.m. 2026-10-01.
    const campaigns = { 8: { monthlyCost: 29, endDate: '2026-10-01' } };
    const during = computeSpendSnapshot([8], [], {}, {}, campaigns, new Date(2026, 8, 1)); // 2026-09-01
    expect(during.totalKr).toBe(29); // campaign price flows through the whole snapshot
    const after = computeSpendSnapshot([8], [], {}, {}, campaigns, new Date(2026, 9, 2)); // 2026-10-02
    expect(after.totalKr).toBe(169); // reverted to ordinary, no manual cleanup
  });

  it('counts followed series (mina) as active backlog, ignores sedd/avbruten', () => {
    const seriesActive = mk({ tmdbId: 2, mediaType: 'tv', status: 'mina', providers: [76] });
    const watched = mk({ tmdbId: 3, status: 'sedd', providers: [8] }); // sedd → not backlog
    const snap = computeSpendSnapshot([8, 76], [seriesActive, watched], {});
    expect(snap.activeKr).toBe(169);          // Viaplay active via the followed series
    expect(snap.idleProviders.map(p => p.id)).toEqual([8]); // Netflix idle (only a sedd title)
  });

  it('excludes free services (0 cost) from spend', () => {
    // SVT Play (520) is free → not counted even though owned.
    const snap = computeSpendSnapshot([520, 8], [mk({ providers: [8] })], {});
    expect(snap.totalKr).toBe(169);
    // And the free service must NOT show up as idle spend (pins the cost<=0 guard).
    expect(snap.idleProviders.some(p => p.id === 520)).toBe(false);
  });

  it('collapses an alias+canonical pair so a service is not double-counted (BIN-409)', () => {
    // Legacy user with both Paramount+ (531, now an alias of SkyShowtime) and
    // SkyShowtime (431) selected — SkyShowtime (109) must be counted once, not 218.
    const snap = computeSpendSnapshot([531, 431], [], {});
    expect(snap.totalKr).toBe(109);
    expect(snap.idleProviders.map(p => p.id)).toEqual([431]);
  });

  it('sorts idle providers priciest-first', () => {
    // Three DISTINCT catalog prices so the sort is deterministic (Netflix and
    // Viaplay both 169 post-2026-07, so this uses Netflix/Max/Disney+ instead).
    const snap = computeSpendSnapshot([337, 8, 384], [], {}); // none active
    // Netflix 169 > Max 149 > Disney+ 109
    expect(snap.idleProviders.map(p => p.id)).toEqual([8, 384, 337]);
    expect(snap.activeKr).toBe(0);
    expect(snap.idleKr).toBe(snap.totalKr);
  });
});
