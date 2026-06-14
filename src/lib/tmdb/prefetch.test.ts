import { describe, it, expect } from 'vitest';
import { titlePrefetchSpec } from './prefetch';
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
