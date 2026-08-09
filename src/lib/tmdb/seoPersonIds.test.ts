import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the TMDB client — collectPersonIds is the only thing under test; we feed
// it fixtures and assert the merge/dedup/slice order (which determines WHICH ids
// survive the SEO_PERSON_TARGET_IDS cap, so it must be deterministic).
vi.mock('@/lib/tmdb/client', () => ({
  getPopularMovies: vi.fn(),
  getMovie: vi.fn(),
}));

// BIN-823: the cast-detail phase now goes through fetchForBuild so it shares the
// warm .tmdb-cache with the title pages instead of re-fetching ~2 000 movies on
// every build. Mocked as a passthrough for two reasons: it keeps every existing
// order/dedup assertion meaningful, and it stops the suite from reading or
// writing the repo's REAL .tmdb-cache — which silently made the
// "all credit fetches reject" case pass from cache instead of from the fetcher.
vi.mock('@/lib/tmdb/buildFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./buildFetch')>()),
  fetchForBuild: vi.fn(
    (_kind: string, fetcher: (id: number) => Promise<unknown>, id: number) => fetcher(id),
  ),
}));

import { getPopularMovies, getMovie } from '@/lib/tmdb/client';
import { fetchForBuild } from '@/lib/tmdb/buildFetch';
import { collectPersonIds } from './seoPersonIds';
import { SEO_PERSON_CAST_PER_MOVIE } from './seoCoverage';

const mockPopular = vi.mocked(getPopularMovies);
const mockGetMovie = vi.mocked(getMovie);
const mockFetchForBuild = vi.mocked(fetchForBuild);

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

  // BIN-823. Without this the wiring is invisible: routing the cast reads back
  // through the raw client would still pass every assertion above while quietly
  // restoring ~2 000 uncached fetches per build.
  it('reads cast details through fetchForBuild so they share the build cache', async () => {
    mockPopular.mockResolvedValue(movieList([7]));
    mockGetMovie.mockResolvedValue(movieDetail([100]));

    await collectPersonIds();

    expect(mockFetchForBuild).toHaveBeenCalledTimes(1);
    expect(mockFetchForBuild.mock.calls[0][0]).toBe('movie');
    expect(mockFetchForBuild.mock.calls[0][2]).toBe(7);
  });

  it('passes a fresh signal per popular-list fetch when a signal factory is supplied', async () => {
    mockPopular.mockResolvedValue(movieList([1]));
    mockGetMovie.mockResolvedValue(movieDetail([100]));
    const signal = vi.fn(() => undefined);
    await collectPersonIds({ signal });
    // The list phase takes the caller's factory; the detail phase gets its own
    // buildSignal() from inside fetchForBuild, so it is not this factory's job.
    expect(signal).toHaveBeenCalled();
    expect(mockPopular.mock.calls[0][1]).toEqual({ signal: undefined });
  });
});
