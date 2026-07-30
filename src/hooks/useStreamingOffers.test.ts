import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
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

vi.mock('@/lib/firebase/db', () => ({
  fsdb: async () => ({
    db: {},
    doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
    getDoc: async (ref: { path: string }) => {
      readPaths.push(ref.path);
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

beforeEach(() => {
  docs.clear();
  readPaths.length = 0;
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
