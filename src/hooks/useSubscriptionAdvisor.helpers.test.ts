import { describe, it, expect } from 'vitest';
import { advisorTmdbIds } from './useSubscriptionAdvisor.helpers';
import type { WatchlistItem } from '@/types';

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
