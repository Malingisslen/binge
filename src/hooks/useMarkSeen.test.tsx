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
  upsertTitle: vi.fn<(payload: Record<string, unknown>) => Promise<void>>(async () => {}),
  logViewing: vi.fn<(payload: Record<string, unknown>) => Promise<void>>(async () => {}),
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

// BIN-655: intent is no longer an argument to inspect — it is WHICH function the hook
// called. These read whichever one fired, so the payload assertions below stay about the
// payload and the intent assertions stay about the choice.
const writes = () => [...watchlist.upsertTitle.mock.calls, ...watchlist.logViewing.mock.calls];
const payloadOf = (call: number) => writes()[call][0];

describe('useMarkSeen — forwards the intent it was given (BIN-641)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchlist.getItem.mockReturnValue(null);
  });

  it('forwards a deliberate re-viewing as one', async () => {
    const { result } = renderHook(() => useMarkSeen());
    await act(async () => { await result.current(film, { countsAsViewing: true }); });

    // The whole of BIN-655 in one assertion: a deliberate re-viewing reaches the
    // counting entry point, and the bulk one is not touched. A boolean a caller can
    // forget has become a function a caller has to name.
    expect(watchlist.logViewing).toHaveBeenCalledTimes(1);
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
    expect(payloadOf(0)).toMatchObject({ status: 'sedd' });
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

    // The inverse, and the one that matters most: an ordinary "Sedd" must never
    // reach the counting path. This is BIN-599's class of bug made unreachable —
    // the caller cannot arrive there by omission.
    expect(watchlist.upsertTitle).toHaveBeenCalledTimes(1);
    expect(watchlist.logViewing).not.toHaveBeenCalled();
  });

  // A series lands as 'mina', so no rewatch can follow either way — but the
  // hook must still forward what it was given, not decide per media type.
  it('forwards the same intent for a series', async () => {
    const { result } = renderHook(() => useMarkSeen());
    await act(async () => { await result.current(series, { countsAsViewing: true }); });

    expect(watchlist.logViewing).toHaveBeenCalledTimes(1);
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
    expect(payloadOf(0)).toMatchObject({ status: 'mina' });
  });

  it('writes nothing at all when the series lookup fails', async () => {
    fetchQuery.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useMarkSeen());
    await act(async () => { await result.current(series); });

    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
    expect(watchlist.logViewing).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith('Kunde inte hämta serieinfo, försök igen');
  });
});

// BIN-814. `markSeen` is how most titles reach 'sedd'/'mina', and the add it performs
// also stamps providersCheckedAt — which gates the title-page repair out for 60 days.
// Accepting `subscriptionProviders` into MarkSeenInput and then quietly not forwarding
// it is the worst of both: the caller believes the field landed, and the advisor keeps
// reading the broad array on exactly the titles the split exists for. Both branches
// (film and series) forward it, so both are pinned.
describe('useMarkSeen — the two provider fields reach the write together (BIN-814)', () => {
  const VIAPLAY = 76;
  beforeEach(() => {
    vi.clearAllMocks();
    watchlist.getItem.mockReturnValue(null);
  });

  it('forwards the subscription subset on the FILM branch', async () => {
    const { result } = renderHook(() => useMarkSeen());
    await act(async () => {
      await result.current({ ...film, providers: [VIAPLAY], subscriptionProviders: [] });
    });

    const payload = payloadOf(0);
    expect(payload.providers).toEqual([VIAPLAY]);
    // The empty array is the whole point: rent-only on Viaplay. It has to be
    // WRITTEN, not dropped, or the row stays null and falls back to the broad list.
    expect(payload.subscriptionProviders).toEqual([]);
  });

  it('forwards the subscription subset on the SERIES branch', async () => {
    const { result } = renderHook(() => useMarkSeen());
    await act(async () => {
      await result.current({ ...series, providers: [VIAPLAY], subscriptionProviders: [VIAPLAY] });
    });

    const payload = payloadOf(0);
    expect(payload.providers).toEqual([VIAPLAY]);
    expect(payload.subscriptionProviders).toEqual([VIAPLAY]);
  });

  it('omits both when the caller knows neither, so stored values survive', async () => {
    const { result } = renderHook(() => useMarkSeen());
    await act(async () => { await result.current(film); });

    const payload = payloadOf(0);
    expect('providers' in payload).toBe(false);
    expect('subscriptionProviders' in payload).toBe(false);
  });
});
