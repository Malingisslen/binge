import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchForBuild,
  buildSignal,
  BUILD_FETCH_TIMEOUT_MS,
  REFRESH_AFTER_MS,
  buildFetchCount,
  __resetBuildFetchState,
} from './buildFetch';
import { readBuildCacheEntry, writeBuildCache } from './buildCache';

vi.mock('./buildCache', () => ({
  readBuildCacheEntry: vi.fn(),
  writeBuildCache: vi.fn(),
}));

const NOW = 1_000_000_000;
const fresh = <T>(data: T) => ({ data, fetchedAt: NOW }); // age 0
const stale = <T>(data: T) => ({ data, fetchedAt: NOW - REFRESH_AFTER_MS - 1 }); // strax bortom tröskeln

describe('buildSignal', () => {
  it('returnerar en AbortSignal', () => {
    const sig = buildSignal();
    expect(sig).toBeInstanceOf(AbortSignal);
    expect(sig.aborted).toBe(false);
  });

  it('exponerar en rimlig timeout-konstant (<= 30s, < Next 60s-tak)', () => {
    expect(BUILD_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(BUILD_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe('fetchForBuild', () => {
  beforeEach(() => {
    vi.mocked(readBuildCacheEntry).mockReset();
    vi.mocked(writeBuildCache).mockReset();
    __resetBuildFetchState();
    delete process.env.TMDB_BUILD_REFRESH_BUDGET;
  });

  afterEach(() => {
    delete process.env.TMDB_BUILD_REFRESH_BUDGET;
  });

  it('färsk cache-post: returnerar cachad data utan fetch, write eller budget-kostnad', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(fresh({ name: 'cached' }));
    const fetcher = vi.fn(async () => ({ name: 'fresh' }));
    const result = await fetchForBuild('tv', fetcher, 1438, NOW);
    expect(result).toEqual({ name: 'cached' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(writeBuildCache).not.toHaveBeenCalled();
    expect(buildFetchCount()).toBe(0);
  });

  it('saknad post: anropar fetchern med signal, skriver resultatet, returnerar det', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(null);
    const fetcher = vi.fn<(id: number, opts?: { signal?: AbortSignal }) => Promise<{ name: string }>>(
      async () => ({ name: 'fresh' }),
    );
    const result = await fetchForBuild('tv', fetcher, 1438, NOW);
    expect(result).toEqual({ name: 'fresh' });
    const [id, opts] = fetcher.mock.calls[0];
    expect(id).toBe(1438);
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
    expect(writeBuildCache).toHaveBeenCalledWith('tv', 1438, { name: 'fresh' }, NOW);
    expect(buildFetchCount()).toBe(1);
  });

  it('stale post under budget: re-hämtar och returnerar färsk data', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(stale({ name: 'old' }));
    const fetcher = vi.fn(async () => ({ name: 'new' }));
    const result = await fetchForBuild('tv', fetcher, 1, NOW);
    expect(result).toEqual({ name: 'new' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(writeBuildCache).toHaveBeenCalledWith('tv', 1, { name: 'new' }, NOW);
    expect(buildFetchCount()).toBe(1); // stale-refresh räknas mot budgeten
  });

  it('stale post ÖVER budget: serverar stale utan att hämta', async () => {
    process.env.TMDB_BUILD_REFRESH_BUDGET = '1';
    vi.mocked(readBuildCacheEntry).mockReturnValue(stale({ name: 'old' }));
    const fetcher = vi.fn(async () => ({ name: 'new' }));
    // Första stale-hämtningen förbrukar budgeten (1).
    const first = await fetchForBuild('tv', fetcher, 1, NOW);
    expect(first).toEqual({ name: 'new' });
    expect(buildFetchCount()).toBe(1);
    fetcher.mockClear();
    // Budget förbrukad → nästa stale-post serveras utan fetch.
    const second = await fetchForBuild('tv', fetcher, 2, NOW);
    expect(second).toEqual({ name: 'old' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('saknad post ÖVER budget: kastar (skjuts upp till ett senare bygge)', async () => {
    process.env.TMDB_BUILD_REFRESH_BUDGET = '1';
    // Första anropet: saknad → hämtar (förbrukar budget 1).
    vi.mocked(readBuildCacheEntry).mockReturnValueOnce(null);
    const fetcher = vi.fn(async () => ({ name: 'new' }));
    await fetchForBuild('tv', fetcher, 1, NOW);
    expect(buildFetchCount()).toBe(1);
    // Andra anropet: saknad + över budget → kastar.
    vi.mocked(readBuildCacheEntry).mockReturnValueOnce(null);
    await expect(fetchForBuild('tv', fetcher, 2, NOW)).rejects.toThrow(/budget reached/);
  });

  it('hämtning misslyckas men stale finns: serverar stale (kastar inte)', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(stale({ name: 'old' }));
    const fetcher = vi.fn(async () => { throw new Error('aborted'); });
    const result = await fetchForBuild('tv', fetcher, 1, NOW);
    expect(result).toEqual({ name: 'old' });
    expect(writeBuildCache).not.toHaveBeenCalled();
  });

  it('hämtning misslyckas och posten saknas: propagerar felet, skriver inte', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(null);
    const fetcher = vi.fn(async () => { throw new Error('aborted'); });
    await expect(fetchForBuild('tv', fetcher, 1, NOW)).rejects.toThrow('aborted');
    expect(writeBuildCache).not.toHaveBeenCalled();
  });

  it('__resetBuildFetchState nollställer budget-räknaren', async () => {
    vi.mocked(readBuildCacheEntry).mockReturnValue(null);
    await fetchForBuild('tv', vi.fn(async () => ({})), 1, NOW);
    expect(buildFetchCount()).toBe(1);
    __resetBuildFetchState();
    expect(buildFetchCount()).toBe(0);
  });
});
