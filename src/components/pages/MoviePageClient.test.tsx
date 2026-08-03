// src/components/pages/MoviePageClient.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// BIN-598 — the two lazy backfills must survive the snapshot arriving LATE.
//
// setRuntime (BIN-93 runtime backfill) and refreshTmdbFields (BIN-402 TMDB
// lazy-refresh / ToS-sweep complement) both look the title up in the watchlist
// and early-return when it is not there. On a hard page load the watchlist
// snapshot ALWAYS lands after `mounted` flips, so the first run of these effects
// necessarily sees an empty library.
//
// It re-fires because `items` sits in both callbacks' dependency arrays, so every
// snapshot mints a new function identity and re-triggers the effects here.
//
// UPDATE (2026-08-04): BIN-598 has LANDED, and `setRuntime`/`refreshTmdbFields`
// were deliberately left OUT of its itemsRef migration for exactly this reason —
// their per-snapshot identity is load-bearing. The earlier version of this header
// predicted the opposite ("BIN-598 removes `items`… which would silently turn
// both backfills into no-ops"); that migration is now explicitly forbidden for
// these two, see WatchlistContext.tsx's setRuntime comment and the identity test
// in WatchlistContext.test.tsx.
//
// The mock below still models stable identity on purpose — but now as a
// deliberately STRICTER world than production, so these assertions pin the
// `loading` gate on its own merits instead of passing on identity churn.
//
// So this drives the WHOLE transition rather than one frame: render while the
// watchlist is still loading, assert neither backfill fired, then flip `loading`
// to false and assert both do. A test that only rendered the settled state would
// pass against the broken version.

// The component's module graph reaches Firebase config, whose top-level getAuth()
// throws on the dummy test-env key. Nothing on the tested path touches it — the
// render short-circuits at the isLoading branch, below every hook.
vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));

const setRuntime = vi.hoisted(() => vi.fn());
const refreshTmdbFields = vi.hoisted(() => vi.fn());
const watchlist = vi.hoisted(() => ({
  loading: true,
  items: [] as unknown[],
  getItem: () => undefined,
  addItem: vi.fn(),
  updateRating: vi.fn(),
  updateNotes: vi.fn(),
  updateWatchedAt: vi.fn(),
  updateTags: vi.fn(),
  setRuntime: vi.fn(),
  refreshTmdbFields: vi.fn(),
}));

// The identity of both callbacks is deliberately STABLE across renders — stricter
// than production, where these two still churn per snapshot on purpose (see the
// header above). Handing back a fresh vi.fn() per call would reproduce that churn
// here and make every assertion below vacuous: the effects would re-fire on
// identity alone, and the `loading` gate they exist to pin would go untested.
watchlist.setRuntime = setRuntime;
watchlist.refreshTmdbFields = refreshTmdbFields;

const movie = {
  id: 603,
  title: 'The Matrix',
  original_title: 'The Matrix',
  overview: 'En hacker upptäcker sanningen.',
  release_date: '1999-03-30',
  runtime: 136,
  poster_path: '/poster.jpg',
  genres: [{ id: 878, name: 'Science Fiction' }],
  'watch/providers': { results: { SE: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } },
};

// `isLoading: true` WITH data: every hook and effect runs, then the render
// short-circuits to LoadingView — so the whole child-component tree stays out of
// the test without mocking twenty-five components that have nothing to do with it.
vi.mock('@/hooks/useTMDB', () => ({ useMovie: () => ({ data: movie, isLoading: true }) }));
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, uid: null }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));
vi.mock('@/hooks/useTitleRatings', () => ({ useTitleRatings: () => ({}) }));
vi.mock('@/hooks/useStreamingOffers', () => ({ useStreamingOffers: () => ({ offers: [] }) }));
vi.mock('@/hooks/useCineasternaCatalog', () => ({
  useCineasternaCatalog: () => ({ has: () => false, rentalFor: () => undefined }),
}));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));

import MoviePageClient from './MoviePageClient';

describe('MoviePageClient — the lazy backfills wait for the watchlist (BIN-598)', () => {
  beforeEach(() => {
    setRuntime.mockReset();
    refreshTmdbFields.mockReset();
    watchlist.loading = true;
    watchlist.items = [];
  });

  it('holds both backfills while the snapshot is still in flight, then fires them once it lands', () => {
    const { rerender } = render(<MoviePageClient id="603" />);

    // Cold load: the library is unknown, so writing now would look the title up
    // in an empty list and no-op forever.
    expect(setRuntime).not.toHaveBeenCalled();
    expect(refreshTmdbFields).not.toHaveBeenCalled();

    // The snapshot lands. NOTE the callback identities do not change — that is
    // precisely why the effects need `loading` in their dependency arrays.
    watchlist.loading = false;
    rerender(<MoviePageClient id="603" />);

    expect(setRuntime).toHaveBeenCalledWith('movie', 603, 136);
    expect(refreshTmdbFields).toHaveBeenCalledWith('movie', 603, expect.objectContaining({
      title: 'The Matrix',
      providers: [8],
      runtime: 136,
    }));
  });
});
