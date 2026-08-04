import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Offer, StreamingOffersDoc } from '@/lib/streaming/offers';

// BIN-564: pin the LEGACY bare-id fallback's safe-fail path.
//
// Docs written before BIN-523 are keyed on the bare `${tmdbId}`, which movie N and
// TV N shared. The hook falls back to such a doc only when the doc's OWN
// `mediaType` field matches what the caller asked for; a mismatch must resolve to
// "no offers", never to the other namespace's rows. That mismatch branch is the
// guard that stops a movie page from showing a TV show's "var kan jag se den" —
// so it gets a test of its own, plus a matching-mediaType control proving the
// fallback is genuinely reached (an unreachable legacy read would make the
// mismatch assertion pass for the wrong reason).

// Minimal Firestore stand-in: docs keyed by `collection/id`, exactly the ids the
// hook builds. `readPaths` records every read so a test can prove WHICH doc ids
// were consulted, in order.
const docs = new Map<string, StreamingOffersDoc>();
const readPaths: string[] = [];
// BIN-638: lets a test hold a single read open (a hanging network) so the 10s
// timeout is the thing that settles the query. Held on a const object so the
// hoisted vi.mock factory reads the CURRENT value, not a captured one.
const gate: { hold: ((path: string) => Promise<void> | null) | null } = { hold: null };

vi.mock('@/lib/firebase/db', () => ({
  fsdb: async () => ({
    db: {},
    doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
    getDoc: async (ref: { path: string }) => {
      readPaths.push(ref.path);
      const held = gate.hold?.(ref.path);
      if (held) await held;
      const data = docs.get(ref.path);
      return { exists: () => data !== undefined, data: () => data };
    },
  }),
}));

import { useStreamingOffers } from './useStreamingOffers';

const anOffer: Offer = {
  providerId: 8,
  type: 'subscription',
  link: 'https://example.test/watch',
  priceAmount: null,
  priceCurrency: null,
  leaving: null,
};

function legacyDoc(mediaType: 'movie' | 'tv'): StreamingOffersDoc {
  return { tmdbId: 123, mediaType, offers: [anOffer], checkedAt: 1_700_000_000_000, source: 'motn' };
}

function wrapper({ children }: { children: ReactNode }) {
  // A fresh client per render: no cross-test cache, and no retry so a rejected
  // query settles immediately instead of being retried into a timeout.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

// A client the test can interrogate directly. The returned `Wrapper` closes over
// ONE client instance — a provider that news up a client inside the component
// body would hand every rerender a fresh cache, which the enabled-gate
// transition test below depends on not happening.
function makeClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, Wrapper };
}

const keyFor = (tmdbId: number | undefined, mediaType: 'movie' | 'tv') =>
  ['streaming-offers', mediaType, tmdbId] as const;

beforeEach(() => {
  docs.clear();
  readPaths.length = 0;
  gate.hold = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useStreamingOffers — legacy bare-id fallback (BIN-564)', () => {
  it('returns no offers when the legacy bare-id doc belongs to the other media type', async () => {
    // Only the legacy doc exists, and it is a TV show's row set; the caller asks
    // for movie 123. Pre-BIN-523 this doc id was shared by both namespaces.
    docs.set('streamingOffers/123', legacyDoc('tv'));

    const { result } = renderHook(() => useStreamingOffers(123, 'movie'), { wrapper });

    // Both reads happen — namespaced first, then the legacy bare id — so the
    // empty result below is the mediaType guard rejecting the doc, not a read
    // that never found it.
    await waitFor(() => expect(readPaths).toEqual(['streamingOffers/movie_123', 'streamingOffers/123']));
    await waitFor(() => expect(result.current.offers).toEqual([]));
    expect(result.current.checkedAt).toBeNull();
  });

  it('still serves the legacy doc when its own mediaType matches (control)', async () => {
    docs.set('streamingOffers/123', legacyDoc('movie'));

    const { result } = renderHook(() => useStreamingOffers(123, 'movie'), { wrapper });

    await waitFor(() => expect(result.current.offers).toEqual([anOffer]));
    expect(result.current.checkedAt).toBe(1_700_000_000_000);
    expect(readPaths).toEqual(['streamingOffers/movie_123', 'streamingOffers/123']);
  });

  // The doc id is only half the movie/tv split — the React Query cache key is the
  // other half. Drop `mediaType` from ['streaming-offers', mediaType, tmdbId] and
  // movie 123 and TV 123 collide on one cache entry, so the second one rendered
  // in a session serves the first one's offers without reading anything at all.
  // A shared client across both renders is what makes that visible; every other
  // test here deliberately uses a fresh one.
  it('does not serve a movie its offers for the TV show with the same id', async () => {
    docs.set('streamingOffers/movie_123', { ...legacyDoc('movie'), checkedAt: 1_700_000_000_000 });
    docs.set('streamingOffers/tv_123', { ...legacyDoc('tv'), checkedAt: 1_900_000_000_000 });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const movie = renderHook(() => useStreamingOffers(123, 'movie'), { wrapper: shared });
    await waitFor(() => expect(movie.result.current.checkedAt).toBe(1_700_000_000_000));

    const tv = renderHook(() => useStreamingOffers(123, 'tv'), { wrapper: shared });
    await waitFor(() => expect(tv.result.current.checkedAt).toBe(1_900_000_000_000));
    // …and it genuinely went and read the TV doc rather than replaying a cache hit.
    expect(readPaths).toContain('streamingOffers/tv_123');
  });

  it('never reads the legacy doc once a namespaced doc exists', async () => {
    docs.set('streamingOffers/movie_123', { ...legacyDoc('movie'), checkedAt: 1_800_000_000_000 });
    // A stale bare-id doc from the other namespace must stay invisible.
    docs.set('streamingOffers/123', legacyDoc('tv'));

    const { result } = renderHook(() => useStreamingOffers(123, 'movie'), { wrapper });

    await waitFor(() => expect(result.current.checkedAt).toBe(1_800_000_000_000));
    expect(readPaths).toEqual(['streamingOffers/movie_123']);
  });
});

// BIN-638: the two branches BIN-564 left untested. Both decide what the
// "var kan jag se den"-box on a title page does when things go sideways.

describe('useStreamingOffers — the enabled gate (BIN-638)', () => {
  it('reads nothing while the tmdb id is still undefined', async () => {
    docs.set('streamingOffers/movie_123', legacyDoc('movie'));
    const { client, Wrapper } = makeClient();

    const { result } = renderHook(() => useStreamingOffers(undefined, 'movie'), {
      wrapper: Wrapper,
    });
    // Give a fetch every chance to start before claiming none did.
    await act(async () => {});

    expect(readPaths).toEqual([]);
    // `readPaths` alone can't tell "the gate held" from "the query ran and the
    // queryFn's own null-guard returned first" — that mutant bills no read
    // either, but it SETTLES the query. So assert the query never left idle.
    // No `?? default` on either read: `keyFor` re-states the hook's query key
    // locally, so if the key ever drifts `getQueryState` returns undefined — and
    // defaults would let both assertions pass on nothing at all, quietly turning
    // this into decoration while `readPaths` carried the test alone.
    const state = client.getQueryState(keyFor(undefined, 'movie'));
    expect(state).toBeDefined();
    expect(state!.fetchStatus).toBe('idle');
    expect(state!.status).toBe('pending');
    expect(result.current.offers).toEqual([]);
    expect(result.current.checkedAt).toBeNull();
  });

  it('fetches as soon as the id arrives — a held gate must not latch', async () => {
    docs.set('streamingOffers/movie_123', legacyDoc('movie'));
    const { client, Wrapper } = makeClient();

    const { result, rerender } = renderHook(
      ({ id }: { id: number | undefined }) => useStreamingOffers(id, 'movie'),
      { wrapper: Wrapper, initialProps: { id: undefined as number | undefined } },
    );
    await act(async () => {});
    expect(readPaths).toEqual([]);

    // The id resolves (the title page finishes loading its metadata) — the whole
    // transition, not just the holding half: a gate that only ever opens on the
    // first render would strand every title page in this state.
    rerender({ id: 123 });

    await waitFor(() => expect(result.current.offers).toEqual([anOffer]));
    expect(result.current.checkedAt).toBe(1_700_000_000_000);
    expect(readPaths).toEqual(['streamingOffers/movie_123']);
    expect(client.getQueryState(keyFor(123, 'movie'))?.status).toBe('success');
  });
});

describe('useStreamingOffers — the 10s read timeout (BIN-157, BIN-638)', () => {
  // getDoc has no timeout of its own, so a hanging network could leave the
  // offers query pending forever. Both facts below are load-bearing: it settles,
  // and it settles at 10s across the WHOLE read, not per getDoc call.
  const startedFetching = async () => {
    // Let the queryFn get past `await fsdb()` and arm its timer before the clock
    // is moved; advancing first would push the deadline out by that much.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readPaths.length).toBeGreaterThan(0);
  };

  // The 10s here is the budget for ONE queryFn attempt, which is the only thing
  // this hook controls. What the visitor waits for is longer: the shared client
  // (src/lib/queryClient.ts) retries while failureCount < 2 and only skips
  // permission-denied / unauthenticated / not-found — and 'streamingOffers
  // timeout' is none of those — so a genuinely hanging network settles the box at
  // roughly 22s (10 + backoff + 10), not 10. `retry: false` below is deliberate,
  // to keep these cases about the hook; the user-visible number is BIN-733.
  it('rejects the query at 10s when the read never comes back', async () => {
    vi.useFakeTimers();
    gate.hold = () => new Promise<void>(() => {}); // never settles
    const { client, Wrapper } = makeClient();

    const { result } = renderHook(() => useStreamingOffers(123, 'movie'), { wrapper: Wrapper });
    await startedFetching();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_900);
    });
    // Still waiting just short of the deadline — pins the 10s, not "some timeout".
    expect(client.getQueryState(keyFor(123, 'movie'))?.status).toBe('pending');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const state = client.getQueryState(keyFor(123, 'movie'));
    expect(state?.status).toBe('error');
    expect((state?.error as Error | null)?.message).toBe('streamingOffers timeout');
    expect(result.current.offers).toEqual([]);
    expect(result.current.checkedAt).toBeNull();
  });

  it('spans both reads: a slow namespaced read eats the legacy read’s budget', async () => {
    vi.useFakeTimers();
    // Namespaced doc is missing and answers slowly; the legacy read then hangs.
    gate.hold = (path) =>
      path === 'streamingOffers/movie_123'
        ? new Promise<void>((resolve) => setTimeout(resolve, 6_000))
        : new Promise<void>(() => {});
    const { client, Wrapper } = makeClient();

    renderHook(() => useStreamingOffers(123, 'movie'), { wrapper: Wrapper });
    await startedFetching();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_100);
    });
    expect(readPaths).toEqual(['streamingOffers/movie_123', 'streamingOffers/123']);
    expect(client.getQueryState(keyFor(123, 'movie'))?.status).toBe('pending');

    // 10s after the FIRST read started — a per-read timeout would still be
    // waiting here, with ~6s left on the legacy read's own clock.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    const state = client.getQueryState(keyFor(123, 'movie'));
    expect(state?.status).toBe('error');
    expect((state?.error as Error | null)?.message).toBe('streamingOffers timeout');
  });

  it('clears its timer when the read wins, leaving nothing armed', async () => {
    vi.useFakeTimers();
    // Spy on the faked globals so the assertion names THIS hook's 10s timer, not
    // whatever else (React, React Query) happens to be scheduled.
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    docs.set('streamingOffers/movie_123', legacyDoc('movie'));
    const { client, Wrapper } = makeClient();

    const { result } = renderHook(() => useStreamingOffers(123, 'movie'), { wrapper: Wrapper });
    await startedFetching();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(client.getQueryState(keyFor(123, 'movie'))?.status).toBe('success');
    expect(result.current.offers).toEqual([anOffer]);

    const armed = setSpy.mock.calls
      .map((call, i) => ({ delay: call[1], handle: setSpy.mock.results[i]?.value }))
      .filter((call) => call.delay === 10_000);
    expect(armed).toHaveLength(1); // the read timeout was armed exactly once
    // …and released by the `finally { clearTimeout(timer) }`. Drop that and a
    // 10s timer outlives every settled read, on a hook that runs on every title
    // page — and it would still fire long after the box has its data.
    expect(clearSpy).toHaveBeenCalledWith(armed[0].handle);
  });
});
