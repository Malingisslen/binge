import { describe, it, expect } from 'vitest';
import { advisorTmdbIds } from './useSubscriptionAdvisor.helpers';

describe('advisorTmdbIds', () => {
  const following = [{ tmdbId: 1, mediaType: 'tv' }, { tmdbId: 2, mediaType: 'tv' }] as any;
  const willSee = [{ tmdbId: 2, mediaType: 'tv' }, { tmdbId: 3, mediaType: 'movie' }, { tmdbId: 4, mediaType: 'tv' }] as any;

  it('returnerar tom lista när enabled = false (ingen fan-out)', () => {
    expect(advisorTmdbIds(false, following, willSee)).toEqual([]);
  });
  it('unionar following-TV + vill_se-TV (dedupat), utan film, när enabled', () => {
    expect(advisorTmdbIds(true, following, willSee).sort((a, b) => a - b)).toEqual([1, 2, 4]);
  });
  it('returnerar tom lista för tom input (och vill_se med bara film)', () => {
    expect(advisorTmdbIds(true, [], [])).toEqual([]);
    expect(advisorTmdbIds(true, [], [{ tmdbId: 5, mediaType: 'movie' }] as any)).toEqual([]);
  });
  it('inkluderar film i followingTV (caller-ansvar: bara TV ska skickas in)', () => {
    // Pinnar det implicita kontraktet — following filtreras INTE på mediaType.
    const followingWithMovie = [{ tmdbId: 1, mediaType: 'tv' }, { tmdbId: 99, mediaType: 'movie' }] as any;
    expect(advisorTmdbIds(true, followingWithMovie, []).sort((a, b) => a - b)).toEqual([1, 99]);
  });
});
