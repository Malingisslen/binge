import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchForBuild, buildSignal, BUILD_FETCH_TIMEOUT_MS } from './buildFetch';
import { readBuildCache, writeBuildCache } from './buildCache';

vi.mock('./buildCache', () => ({
  readBuildCache: vi.fn(),
  writeBuildCache: vi.fn(),
}));

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
    vi.mocked(readBuildCache).mockReset();
    vi.mocked(writeBuildCache).mockReset();
  });

  it('cache-träff: returnerar cachad data utan att anropa fetchern', async () => {
    vi.mocked(readBuildCache).mockReturnValue({ name: 'cached' });
    const fetcher = vi.fn(async () => ({ name: 'fresh' }));
    const result = await fetchForBuild('tv', fetcher, 1438);
    expect(result).toEqual({ name: 'cached' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(writeBuildCache).not.toHaveBeenCalled();
  });

  it('cache-miss: anropar fetchern med signal, skriver resultatet, returnerar det', async () => {
    vi.mocked(readBuildCache).mockReturnValue(null);
    const fetcher = vi.fn<(id: number, opts?: { signal?: AbortSignal }) => Promise<{ name: string }>>(
      async () => ({ name: 'fresh' }),
    );
    const result = await fetchForBuild('tv', fetcher, 1438);
    expect(result).toEqual({ name: 'fresh' });
    const [id, opts] = fetcher.mock.calls[0];
    expect(id).toBe(1438);
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
    expect(writeBuildCache).toHaveBeenCalledWith('tv', 1438, { name: 'fresh' });
  });

  it('propagerar fetcher-fel och skriver inte till cachen', async () => {
    vi.mocked(readBuildCache).mockReturnValue(null);
    const fetcher = vi.fn(async () => { throw new Error('aborted'); });
    await expect(fetchForBuild('tv', fetcher, 1)).rejects.toThrow('aborted');
    expect(writeBuildCache).not.toHaveBeenCalled();
  });
});
