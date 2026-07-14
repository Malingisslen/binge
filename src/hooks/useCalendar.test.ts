import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { NextAirUpdate } from '@/lib/watchlist/nextAirReadRepair';

// BIN-508: hook-level coverage for useCalendar's next-air read-repair EFFECT.
// The pure engine (collectNextAirUpdates / flushNextAirWrites) is unit-tested in
// nextAirReadRepair.test.ts; here we pin the wiring the pure layer can't see: the
// 1200 ms debounce that coalesces the fan-out burst, the uid/enabled guards, that
// the flush is forwarded uid + updates, and that unmounting before the debounce
// fires cancels the pending write (best-effort — next visit repairs).

// Controllable output of the (mocked) pure collector — the effect only branches on
// its length and forwards the array, so driving this is enough to exercise the effect.
let mockUpdates: NextAirUpdate[] = [];
const collectNextAirUpdates = vi.fn(() => mockUpdates);
const flushNextAirWrites = vi.fn(async () => {});
vi.mock('@/lib/watchlist/nextAirReadRepair', () => ({
  collectNextAirUpdates: (...a: unknown[]) => collectNextAirUpdates(...(a as [])),
  flushNextAirWrites: (...a: unknown[]) => flushNextAirWrites(...(a as [])),
}));

// Auth uid drives the guard + is forwarded to flush. Mutable per test.
const authState = { uid: 'u1' as string | null };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authState }));

// Watchlist: an empty library keeps the TMDB query fan-out trivial (no ids → no
// queries) so the test isolates the read-repair effect, not the query waterfall.
vi.mock('@/hooks/useWatchlist', () => ({
  useWatchlist: () => ({ getByStatus: () => [], items: [] }),
}));

// react-query useQueries: no ids → empty query set. Returns [] for every call
// (shows / seasons / movies), so `shows` and `movies` resolve to [].
vi.mock('@tanstack/react-query', () => ({ useQueries: () => [] }));

import { useCalendarEntries } from './useCalendar';

const anUpdate: NextAirUpdate = { tmdbId: 1, delta: { nextAirDate: '2026-08-01' } };

beforeEach(() => {
  vi.useFakeTimers();
  collectNextAirUpdates.mockClear();
  flushNextAirWrites.mockClear();
  authState.uid = 'u1';
  mockUpdates = [];
});
afterEach(() => vi.useRealTimers());

describe('useCalendar — next-air read-repair effect (BIN-508)', () => {
  it('debounces the flush by 1200 ms and forwards uid + updates', () => {
    mockUpdates = [anUpdate];
    renderHook(() => useCalendarEntries());

    // Before the debounce window elapses, nothing is written.
    act(() => { vi.advanceTimersByTime(1199); });
    expect(flushNextAirWrites).not.toHaveBeenCalled();

    // At 1200 ms the coalesced batch flushes exactly once with uid + the updates.
    act(() => { vi.advanceTimersByTime(1); });
    expect(flushNextAirWrites).toHaveBeenCalledTimes(1);
    expect(flushNextAirWrites).toHaveBeenCalledWith('u1', [anUpdate]);
  });

  it('never writes when there is nothing to repair (empty updates)', () => {
    mockUpdates = [];
    renderHook(() => useCalendarEntries());
    act(() => { vi.advanceTimersByTime(2000); });
    expect(flushNextAirWrites).not.toHaveBeenCalled();
  });

  it('never writes for a logged-out user (uid guard)', () => {
    authState.uid = null;
    mockUpdates = [anUpdate];
    renderHook(() => useCalendarEntries());
    act(() => { vi.advanceTimersByTime(2000); });
    // The guard returns before scheduling the debounce; the collector is never run.
    expect(collectNextAirUpdates).not.toHaveBeenCalled();
    expect(flushNextAirWrites).not.toHaveBeenCalled();
  });

  it('never writes when the hook is disabled (enabled=false guard)', () => {
    mockUpdates = [anUpdate];
    renderHook(() => useCalendarEntries({ enabled: false }));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(collectNextAirUpdates).not.toHaveBeenCalled();
    expect(flushNextAirWrites).not.toHaveBeenCalled();
  });

  it('cancels the pending flush when unmounted before the debounce fires', () => {
    mockUpdates = [anUpdate];
    const { unmount } = renderHook(() => useCalendarEntries());
    // Unmount inside the debounce window → cleanup clears the timeout.
    act(() => { vi.advanceTimersByTime(600); });
    unmount();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(flushNextAirWrites).not.toHaveBeenCalled();
  });
});
