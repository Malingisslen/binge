import { describe, it, expect, vi, afterEach } from 'vitest';
import { getMovieLite, TMDB_REQUEST_TIMEOUT_MS, TMDB_TIMEOUT_MESSAGE } from './client';
import { isReadTimeoutMessage, shouldRetryQuery } from '@/lib/queryClient';

process.env.NEXT_PUBLIC_TMDB_API_KEY = 'test-key';

/** A fetch that never answers on its own: it settles only when its signal aborts,
 *  which is how a stalled connection looks from the page. */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      // Like the real fetch: an already-aborted signal rejects at once.
      if (init?.signal?.aborted) abort();
      init?.signal?.addEventListener('abort', abort);
    }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('tmdbFetch request timeout', () => {
  it('gives up on a request that never answers, with a message React Query will not retry', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const pending = getMovieLite(1);
    const settled = expect(pending).rejects.toThrow(TMDB_TIMEOUT_MESSAGE);
    await vi.advanceTimersByTimeAsync(TMDB_REQUEST_TIMEOUT_MS);
    await settled;

    expect(isReadTimeoutMessage(TMDB_TIMEOUT_MESSAGE)).toBe(true);
    expect(shouldRetryQuery(0, new Error(TMDB_TIMEOUT_MESSAGE))).toBe(false);
  });

  it('has not given up just before the limit', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    let outcome: 'pending' | 'rejected' = 'pending';
    const pending = getMovieLite(2).catch(() => { outcome = 'rejected'; });
    await vi.advanceTimersByTimeAsync(TMDB_REQUEST_TIMEOUT_MS - 1);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(outcome).toBe('rejected');
  });

  it('frees the concurrency slots, so a request queued behind eight stalled ones still gets through', async () => {
    vi.useFakeTimers();
    const ok = new Response(JSON.stringify({ id: 99 }), { status: 200 });
    const fetchMock = hangingFetch();
    // The first eight calls fill every slot and hang; the ninth answers at once.
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls++;
      return calls <= 8 ? fetchMock(url, init) : Promise.resolve(ok);
    }));

    const stalled = Array.from({ length: 8 }, (_, i) => getMovieLite(100 + i).catch(() => 'timed out'));
    const queued = getMovieLite(99);
    await vi.advanceTimersByTimeAsync(TMDB_REQUEST_TIMEOUT_MS);

    await expect(queued).resolves.toEqual({ id: 99 });
    expect(await Promise.all(stalled)).toEqual(Array(8).fill('timed out'));
  });

  it('still reports a caller abort as an abort, not as a timeout', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const controller = new AbortController();
    const pending = getMovieLite(3, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
