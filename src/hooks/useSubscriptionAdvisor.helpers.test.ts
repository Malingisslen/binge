import { describe, it, expect } from 'vitest';
import { advisorTmdbIds, rankCoverageOptions } from './useSubscriptionAdvisor.helpers';
import type { WatchlistItem, WillSeePerProviderRow } from '@/types';

// Avsiktligt partiella mocks — advisorTmdbIds läser bara tmdbId + mediaType.
const mk = (tmdbId: number, mediaType: WatchlistItem['mediaType']): WatchlistItem =>
  ({ tmdbId, mediaType }) as unknown as WatchlistItem;

describe('advisorTmdbIds', () => {
  const following = [mk(1, 'tv'), mk(2, 'tv')];
  const willSee = [mk(2, 'tv'), mk(3, 'movie'), mk(4, 'tv')];

  it('returnerar tom lista när enabled = false (ingen fan-out)', () => {
    expect(advisorTmdbIds(false, following, willSee)).toEqual([]);
  });
  it('unionar following-TV + vill_se-TV (dedupat), utan film, när enabled', () => {
    expect(advisorTmdbIds(true, following, willSee).sort((a, b) => a - b)).toEqual([1, 2, 4]);
  });
  it('returnerar tom lista för tom input (och vill_se med bara film)', () => {
    expect(advisorTmdbIds(true, [], [])).toEqual([]);
    expect(advisorTmdbIds(true, [], [mk(5, 'movie')])).toEqual([]);
  });
  it('inkluderar film i followingTV (caller-ansvar: bara TV ska skickas in)', () => {
    // Pinnar det implicita kontraktet — following filtreras INTE på mediaType.
    const followingWithMovie = [mk(1, 'tv'), mk(99, 'movie')];
    expect(advisorTmdbIds(true, followingWithMovie, []).sort((a, b) => a - b)).toEqual([1, 99]);
  });
});

describe('rankCoverageOptions (BIN-87)', () => {
  const row = (over: Partial<WillSeePerProviderRow>): WillSeePerProviderRow => ({
    providerId: 1, providerName: 'P', shortName: 'P', color: '#000',
    isSubscribed: false, monthlyCost: 100, tvCount: 0, movieCount: 0, ...over,
  });

  it('rankar ej-tecknade betalda tjänster efter mest täckning först', () => {
    const result = rankCoverageOptions([
      row({ providerId: 1, providerName: 'Max', monthlyCost: 149, tvCount: 4, movieCount: 3 }),  // 7 titlar
      row({ providerId: 2, providerName: 'Viaplay', monthlyCost: 169, tvCount: 2, movieCount: 0 }), // 2 titlar
    ]);
    expect(result.map(o => o.providerId)).toEqual([1, 2]);
    expect(result[0].titleCount).toBe(7);
    expect(result[0].krPerTitle).toBe(Math.round(149 / 7)); // 21
  });

  it('exkluderar redan tecknade tjänster', () => {
    const result = rankCoverageOptions([
      row({ providerId: 1, isSubscribed: true, tvCount: 9 }),
      row({ providerId: 2, isSubscribed: false, tvCount: 1 }),
    ]);
    expect(result.map(o => o.providerId)).toEqual([2]);
  });

  it('exkluderar gratis/0-kr-tjänster (inget att skaffa) och tjänster utan täckning', () => {
    expect(rankCoverageOptions([row({ providerId: 1, monthlyCost: 0, tvCount: 5 })])).toEqual([]);
    expect(rankCoverageOptions([row({ providerId: 2, monthlyCost: null, tvCount: 5 })])).toEqual([]);
    expect(rankCoverageOptions([row({ providerId: 3, monthlyCost: 99, tvCount: 0, movieCount: 0 })])).toEqual([]);
  });

  it('vid lika täckning vinner lägst kr/titel', () => {
    const result = rankCoverageOptions([
      row({ providerId: 1, providerName: 'Dyr', monthlyCost: 200, tvCount: 2, movieCount: 0 }),   // 100 kr/titel
      row({ providerId: 2, providerName: 'Billig', monthlyCost: 80, tvCount: 1, movieCount: 1 }), // 40 kr/titel
    ]);
    expect(result.map(o => o.providerId)).toEqual([2, 1]);
  });

  it('avrundar kr/titel (round, inte floor) och fyller alla CoverageOption-fält', () => {
    // 79/2 = 39.5 → Math.round = 40 (floor skulle ge 39) → pinnar avrundningen.
    const [opt] = rankCoverageOptions([
      row({ providerId: 7, providerName: 'Max', shortName: 'HBO', color: '#7B2FBE', monthlyCost: 79, tvCount: 1, movieCount: 1 }),
    ]);
    expect(opt).toEqual({
      providerId: 7, providerName: 'Max', shortName: 'HBO', color: '#7B2FBE',
      monthlyCost: 79, titleCount: 2, tvCount: 1, movieCount: 1, krPerTitle: 40,
    });
  });
});
