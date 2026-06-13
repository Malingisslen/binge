import { describe, it, expect, vi } from 'vitest';
import { fetchForBuild, buildSignal, BUILD_FETCH_TIMEOUT_MS } from './buildFetch';

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
  it('anropar fetchern med id och en abort-signal', async () => {
    const fetcher = vi.fn(async () => ({ ok: true }));
    const result = await fetchForBuild(fetcher, 1438);
    expect(result).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [id, opts] = fetcher.mock.calls[0];
    expect(id).toBe(1438);
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
  });

  it('propagerar fetcher-fel (sidan faller då tillbaka på tom metadata)', async () => {
    const fetcher = vi.fn(async () => { throw new Error('aborted'); });
    await expect(fetchForBuild(fetcher, 1)).rejects.toThrow('aborted');
  });
});
