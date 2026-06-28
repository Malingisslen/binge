import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the TMDB client — collectPersonIds is the only thing under test; we feed
// it fixtures and assert the merge/dedup/slice order (which determines WHICH ids
// survive the SEO_PERSON_TARGET_IDS cap, so it must be deterministic).
vi.mock('@/lib/tmdb/client', () => ({
  getPopularMovies: vi.fn(),
  getMovie: vi.fn(),
}));

import { getPopularMovies, getMovie } from '@/lib/tmdb/client';
import { collectPersonIds } from './seoPersonIds';
import { SEO_PERSON_CAST_PER_MOVIE } from './seoCoverage';

const mockPopular = vi.mocked(getPopularMovies);
const mockGetMovie = vi.mocked(getMovie);

// Minimal shapes — collectPersonIds only reads .results[].id and .credits.cast[].id.
const movieList = (ids: number[]) => ({ results: ids.map(id => ({ id })) } as never);
const movieDetail = (castIds: number[]) => ({ credits: { cast: castIds.map(id => ({ id })) } } as never);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('collectPersonIds — BIN-337 shared person pipeline', () => {
  it('collects top-billed cast ids in movie-then-cast order, deduped across movies', async () => {
    mockPopular.mockResolvedValue(movieList([1, 2])); // every page returns the same 2 movies
    mockGetMovie.mockImplementation((id: number) => {
      if (id === 1) return Promise.resolve(movieDetail([100, 101]));
      return Promise.resolve(movieDetail([101, 102])); // 101 duplicates movie 1's cast
    });
    const ids = await collectPersonIds();
    // movie 1 → 100,101 ; movie 2 → 101 (dup, skipped), 102 → [100,101,102] in order.
    expect(ids).toEqual([100, 101, 102]);
  });

  it('takes only the first SEO_PERSON_CAST_PER_MOVIE cast members per movie', async () => {
    const over = Array.from({ length: SEO_PERSON_CAST_PER_MOVIE + 2 }, (_, i) => 200 + i);
    mockPopular.mockResolvedValue(movieList([3]));
    mockGetMovie.mockResolvedValue(movieDetail(over));
    const ids = await collectPersonIds();
    expect(ids).toHaveLength(SEO_PERSON_CAST_PER_MOVIE);
    // The two cast members past the cap must be dropped.
    expect(ids).not.toContain(200 + SEO_PERSON_CAST_PER_MOVIE);
    expect(ids).not.toContain(201 + SEO_PERSON_CAST_PER_MOVIE);
  });

  it('returns [] (no fallback) when every popular-movies fetch rejects', async () => {
    mockPopular.mockRejectedValue(new Error('TMDB down'));
    const ids = await collectPersonIds();
    expect(ids).toEqual([]);
    expect(mockGetMovie).not.toHaveBeenCalled(); // no movie ids → no detail fetches
  });

  it('returns [] when movies resolve but all credit fetches reject', async () => {
    mockPopular.mockResolvedValue(movieList([1]));
    mockGetMovie.mockRejectedValue(new Error('credits down'));
    expect(await collectPersonIds()).toEqual([]);
  });

  it('passes a fresh signal per fetch when a signal factory is supplied', async () => {
    mockPopular.mockResolvedValue(movieList([1]));
    mockGetMovie.mockResolvedValue(movieDetail([100]));
    const signal = vi.fn(() => undefined);
    await collectPersonIds({ signal });
    // Called once per popular page + once per movie detail.
    expect(signal).toHaveBeenCalled();
    expect(mockPopular.mock.calls[0][1]).toEqual({ signal: undefined });
  });
});
