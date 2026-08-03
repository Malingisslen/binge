// src/components/pages/TVShowPageClient.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// BIN-598 — the TV sibling of MoviePageClient.test.tsx. Same defect, same fix,
// and it needs its own test: the two files' effects are copies, not a shared
// helper, so a revert of one leaves the other's test green. See the long note in
// MoviePageClient.test.tsx for why the whole loading→settled transition has to be
// driven rather than just the settled frame.

vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));

const setRuntime = vi.hoisted(() => vi.fn());
const refreshTmdbFields = vi.hoisted(() => vi.fn());
const watchlist = vi.hoisted(() => ({
  loading: true,
  items: [] as unknown[],
  getItem: () => undefined,
  updateRating: vi.fn(),
  updateNotes: vi.fn(),
  updateTmdbStatus: vi.fn(),
  updateTags: vi.fn(),
  setRuntime: vi.fn(),
  refreshTmdbFields: vi.fn(),
}));

// Stable identities across renders — deliberately STRICTER than production, not a
// preview of it. BIN-598 landed 2026-08-04 and left setRuntime/refreshTmdbFields
// out of its itemsRef migration on purpose (their per-snapshot identity re-fires
// these backfills), so production still churns here. Pinning stable identity is
// what makes these assertions test the `loading` gate rather than the churn.
// See MoviePageClient.test.tsx.
watchlist.setRuntime = setRuntime;
watchlist.refreshTmdbFields = refreshTmdbFields;

const show = {
  id: 1399,
  name: 'Game of Thrones',
  original_name: 'Game of Thrones',
  overview: 'Sju ätter slåss om järntronen.',
  first_air_date: '2011-04-17',
  episode_run_time: [57],
  poster_path: '/poster.jpg',
  status: 'Ended',
  genres: [{ id: 18, name: 'Drama' }],
  seasons: [],
  'watch/providers': { results: { SE: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } },
};

// `isLoading: true` WITH data: every hook and effect runs, the render
// short-circuits at the LoadingView branch below them.
vi.mock('@/hooks/useTMDB', () => ({ useTVShow: () => ({ data: show, isLoading: true }) }));
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, uid: null }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));
vi.mock('@/hooks/useTitleRatings', () => ({ useTitleRatings: () => ({}) }));
vi.mock('@/hooks/useStreamingOffers', () => ({ useStreamingOffers: () => ({ offers: [] }) }));
vi.mock('@/hooks/useEpisodeProgressWithSync', () => ({
  useEpisodeProgressWithSync: () => ({
    isWatched: () => false,
    markEpisodeWatched: vi.fn(),
    markSeasonWatched: vi.fn(),
    markSeasonUnwatched: vi.fn(),
    getSeasonProgress: () => ({ watched: 0, total: 0 }),
  }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQueryClient: () => ({ prefetchQuery: vi.fn() }),
}));

import TVShowPageClient from './TVShowPageClient';

describe('TVShowPageClient — the lazy backfills wait for the watchlist (BIN-598)', () => {
  beforeEach(() => {
    setRuntime.mockReset();
    refreshTmdbFields.mockReset();
    watchlist.loading = true;
    watchlist.items = [];
  });

  it('holds both backfills while the snapshot is still in flight, then fires them once it lands', () => {
    const { rerender } = render(<TVShowPageClient id="1399" />);

    expect(setRuntime).not.toHaveBeenCalled();
    expect(refreshTmdbFields).not.toHaveBeenCalled();

    watchlist.loading = false;
    rerender(<TVShowPageClient id="1399" />);

    expect(setRuntime).toHaveBeenCalledWith('tv', 1399, 57);
    expect(refreshTmdbFields).toHaveBeenCalledWith('tv', 1399, expect.objectContaining({
      title: 'Game of Thrones',
      providers: [8],
      tmdbStatus: 'Ended',
      runtime: 57,
    }));
  });
});
