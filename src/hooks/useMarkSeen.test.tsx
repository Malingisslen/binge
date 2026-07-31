// src/hooks/useMarkSeen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { MediaType, WatchlistItem } from '@/types';

// BIN-641: useMarkSeen is THE "jag har sett den"-path — StatusButton and
// QuickAddButton both route their 'sedd' choice through it, and so does the
// new "Sedd igen" action. It does NOT decide whether a rewatch is counted; it
// FORWARDS the caller's intent, because the two gestures are indistinguishable
// at this level.
//
// What is pinned here is that forwarding. Hard-code it either way and every
// test in WatchlistContext.test.tsx stays green while the feature silently
// breaks — counting nothing ever, or counting on an ordinary re-mark, which is
// the exact thing Malin ruled out (the count is editable nowhere).

const watchlist = vi.hoisted(() => ({
  getItem: vi.fn<(mediaType: MediaType, tmdbId: number) => WatchlistItem | null>(() => null),
  addItem: vi.fn<(payload: Record<string, unknown>, opts?: { countsAsViewing?: boolean }) => Promise<void>>(async () => {}),
  updateRating: vi.fn(async () => {}),
}));
const toast = vi.hoisted(() => ({ show: vi.fn(), showRating: vi.fn() }));
const fetchQuery = vi.hoisted(() => vi.fn(async () => ({
  number_of_seasons: 8,
  status: 'Ended',
  last_episode_to_air: { season_number: 8, episode_number: 6 },
})));

vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ fetchQuery }) }));
vi.mock('@/lib/tmdb/client', () => ({ getTVShow: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

import { useMarkSeen } from './useMarkSeen';

const film = { tmdbId: 603, mediaType: 'movie' as const, title: 'The Matrix', posterPath: null, releaseYear: 1999 };
const series = { tmdbId: 1399, mediaType: 'tv' as const, title: 'Game of Thrones', posterPath: null, releaseYear: 2011 };

const optsOf = (call: number) => watchlist.addItem.mock.calls[call][1];

describe('useMarkSeen — forwards the intent it was given (BIN-641)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchlist.getItem.mockReturnValue(null);
  });

  it('forwards a deliberate re-viewing as one', async () => {
    const { result } = renderHook(() => useMarkSeen());
    await act(async () => { await result.current(film, { countsAsViewing: true }); });

    expect(watchlist.addItem).toHaveBeenCalledTimes(1);
    expect(optsOf(0)).toEqual({ countsAsViewing: true });
    expect(watchlist.addItem.mock.calls[0][0]).toMatchObject({ status: 'sedd' });
  });

  // BIN-641: the counted rewatch is the only permanent, un-editable write in
  // the app, and it happens on a screen that never shows the count. It has to
  // say so, or it is indistinguishable from an ordinary re-mark.
  it('confirms a counted rewatch in its own words', async () => {
    watchlist.getItem.mockReturnValue({ status: 'sedd', rating: 4 } as never);
    const { result } = renderHook(() => useMarkSeen());
    await act(async () => { await result.current(film, { countsAsViewing: true }); });

    expect(toast.show).toHaveBeenCalledWith('The Matrix — omtitt räknad');
  });

  // The case that matters most, and the one that catches a toast which stopped
  // asking the shared helper: the flag IS passed, but the title is not 'sedd',
  // so the write counts nothing. Claiming a rewatch here would be a lie about a
  // number the user cannot correct. (An earlier cut of this toast dropped the
  // helper call and passed with only the case above — this is what found it.)
  it('does not claim a rewatch when the flag is passed but nothing counts', async () => {
    watchlist.getItem.mockReturnValue({ status: 'vill_se', rating: 4 } as never);
    const { result } = renderHook(() => useMarkSeen());
    await act(async () => { await result.current(film, { countsAsViewing: true }); });

    expect(toast.show).toHaveBeenCalledWith('The Matrix — Sedd');
  });

  // Same shape on the TV branch: the payload carries 'mina', which can never be
  // a rewatch, so the toast must not claim one however the caller asks.
  it('does not claim a rewatch for a series', async () => {
    watchlist.getItem.mockReturnValue({ status: 'sedd', rating: 4 } as never);
    const { result } = renderHook(() => useMarkSeen());
    await act(async () => { await result.current(series, { countsAsViewing: true }); });

    expect(toast.show).toHaveBeenCalledWith('Game of Thrones — Sedd (alla avsnitt)');
  });

  // …and an ordinary re-mark keeps the ordinary confirmation.
  it('does not claim a rewatch for an ordinary mark-seen', async () => {
    watchlist.getItem.mockReturnValue({ status: 'sedd', rating: 4 } as never);
    const { result } = renderHook(() => useMarkSeen());
    await act(async () => { await result.current(film); });

    expect(toast.show).toHaveBeenCalledWith('The Matrix — Sedd');
  });

  it('forwards NOTHING for an ordinary mark-seen', async () => {
    const { result } = renderHook(() => useMarkSeen());
    await act(async () => { await result.current(film); });

    expect(watchlist.addItem).toHaveBeenCalledTimes(1);
    expect(optsOf(0)?.countsAsViewing ?? false).toBe(false);
  });

  // A series lands as 'mina', so no rewatch can follow either way — but the
  // hook must still forward what it was given, not decide per media type.
  it('forwards the same intent for a series', async () => {
    const { result } = renderHook(() => useMarkSeen());
    await act(async () => { await result.current(series, { countsAsViewing: true }); });

    expect(watchlist.addItem).toHaveBeenCalledTimes(1);
    expect(optsOf(0)).toEqual({ countsAsViewing: true });
    expect(watchlist.addItem.mock.calls[0][0]).toMatchObject({ status: 'mina' });
  });

  it('writes nothing at all when the series lookup fails', async () => {
    fetchQuery.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useMarkSeen());
    await act(async () => { await result.current(series); });

    expect(watchlist.addItem).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith('Kunde inte hämta serieinfo, försök igen');
  });
});
