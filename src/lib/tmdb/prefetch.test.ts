import { describe, it, expect } from 'vitest';
import { titlePrefetchSpec, currentSeasonToPrefetch } from './prefetch';
import { TMDB_STALE } from './cacheTiers';

describe('titlePrefetchSpec', () => {
  it('ger fulla tv-detaljnyckeln + TV_DETAIL för serier', () => {
    const spec = titlePrefetchSpec('tv', 1399);
    expect(spec.queryKey).toEqual(['tv', 1399]);
    expect(spec.staleTime).toBe(TMDB_STALE.TV_DETAIL);
    expect(typeof spec.queryFn).toBe('function');
  });
  it('ger fulla movie-detaljnyckeln + MOVIE_DETAIL för filmer', () => {
    const spec = titlePrefetchSpec('movie', 27205);
    expect(spec.queryKey).toEqual(['movie', 27205]);
    expect(spec.staleTime).toBe(TMDB_STALE.MOVIE_DETAIL);
    expect(typeof spec.queryFn).toBe('function');
  });
});

describe('currentSeasonToPrefetch', () => {
  it('väljer next_episode_to_air-säsongen när den finns', () => {
    expect(currentSeasonToPrefetch({ number_of_seasons: 5, next_episode_to_air: { season_number: 6 } })).toBe(6);
  });
  it('faller tillbaka på sista säsongen utan next_episode', () => {
    expect(currentSeasonToPrefetch({ number_of_seasons: 3, next_episode_to_air: null })).toBe(3);
  });
  it('returnerar null när serien saknar säsonger', () => {
    expect(currentSeasonToPrefetch({ number_of_seasons: 0, next_episode_to_air: null })).toBeNull();
    expect(currentSeasonToPrefetch({})).toBeNull();
  });
});
