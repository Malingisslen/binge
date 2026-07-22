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

// BIN-519: the collector stays controllable, but flush runs the REAL implementation
// (wrapped in flushSpy for call-count assertions) so a hook-layer test can prove the
// payload the real write path produces carries no updatedAt. The real flush's Firebase
// write resolves through the fsdb mock below, which captures each payload.
const flushSpy = vi.fn();
const capturedPayloads: Record<string, unknown>[] = [];
vi.mock('@/lib/firebase/db', () => ({
  fsdb: async () => ({
    db: {},
    doc: () => ({}),
    writeBatch: () => ({
      set: (_ref: unknown, payload: Record<string, unknown>) => { capturedPayloads.push(payload); },
      commit: async () => {},
    }),
    serverTimestamp: () => 'STAMP',
  }),
}));
vi.mock('@/lib/watchlist/nextAirReadRepair', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/watchlist/nextAirReadRepair')>();
  return {
    ...actual,
    collectNextAirUpdates: (...a: unknown[]) => collectNextAirUpdates(...(a as [])),
    flushNextAirWrites: (uid: string, updates: NextAirUpdate[]) => {
      flushSpy(uid, updates);
      return actual.flushNextAirWrites(uid, updates);
    },
  };
});

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

const anUpdate: NextAirUpdate = { mediaType: 'tv', tmdbId: 1, delta: { nextAirDate: '2026-08-01' } };

beforeEach(() => {
  vi.useFakeTimers();
  collectNextAirUpdates.mockClear();
  flushSpy.mockClear();
  capturedPayloads.length = 0;
  authState.uid = 'u1';
  mockUpdates = [];
});
afterEach(() => vi.useRealTimers());

describe('useCalendar — next-air read-repair effect (BIN-508)', () => {
  it('debounces the flush by 1200 ms and forwards uid + updates', async () => {
    mockUpdates = [anUpdate];
    renderHook(() => useCalendarEntries());

    // Before the debounce window elapses, nothing is written.
    act(() => { vi.advanceTimersByTime(1199); });
    expect(flushSpy).not.toHaveBeenCalled();

    // At 1200 ms the coalesced batch flushes exactly once with uid + the updates.
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(flushSpy).toHaveBeenCalledWith('u1', [anUpdate]);
  });

  it('never writes when there is nothing to repair (empty updates)', () => {
    mockUpdates = [];
    renderHook(() => useCalendarEntries());
    act(() => { vi.advanceTimersByTime(2000); });
    expect(flushSpy).not.toHaveBeenCalled();
  });

  it('never writes for a logged-out user (uid guard)', () => {
    authState.uid = null;
    mockUpdates = [anUpdate];
    renderHook(() => useCalendarEntries());
    act(() => { vi.advanceTimersByTime(2000); });
    // The guard returns before scheduling the debounce; the collector is never run.
    expect(collectNextAirUpdates).not.toHaveBeenCalled();
    expect(flushSpy).not.toHaveBeenCalled();
  });

  it('never writes when the hook is disabled (enabled=false guard)', () => {
    mockUpdates = [anUpdate];
    renderHook(() => useCalendarEntries({ enabled: false }));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(collectNextAirUpdates).not.toHaveBeenCalled();
    expect(flushSpy).not.toHaveBeenCalled();
  });

  it('cancels the pending flush when unmounted before the debounce fires', () => {
    mockUpdates = [anUpdate];
    const { unmount } = renderHook(() => useCalendarEntries());
    // Unmount inside the debounce window → cleanup clears the timeout.
    act(() => { vi.advanceTimersByTime(600); });
    unmount();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(flushSpy).not.toHaveBeenCalled();
  });

  // BIN-519: hook-layer invariant — the REAL flush (not a stub) must never write
  // updatedAt. "Fortsätt titta" sorts on updatedAt, so a read-repair write that
  // bumped it would silently reorder the shelf. The pure layer locks this on
  // buildRepairPayload; here we prove it survives the full hook → flush wiring.
  it('the real flush writes a payload with no updatedAt (BIN-519)', async () => {
    authState.uid = 'ainv';
    mockUpdates = [{ mediaType: 'tv', tmdbId: 999, delta: { nextAirDate: '2026-08-01' } }];
    renderHook(() => useCalendarEntries());
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });

    expect(flushSpy).toHaveBeenCalledWith('ainv', mockUpdates);
    expect(capturedPayloads).toHaveLength(1);
    const payload = capturedPayloads[0];
    expect('updatedAt' in payload).toBe(false);
    expect('nextAirUpdatedAt' in payload).toBe(true);
  });

  // BIN-519: several re-renders inside the 1200 ms window must coalesce into a
  // single flush — each effect re-run clears the prior timeout. Guards against a
  // regression that dropped the debounce and wrote once per render (cost churn).
  it('coalesces multiple re-renders within the debounce window into one flush (BIN-519)', async () => {
    authState.uid = 'brender';
    mockUpdates = [{ mediaType: 'tv', tmdbId: 7, delta: { nextAirDate: '2026-08-01' } }];
    const { rerender } = renderHook(() => useCalendarEntries());

    // Re-render three times, each 300 ms apart (900 ms total). Every re-run
    // resets the debounce, so no flush fires yet.
    act(() => { vi.advanceTimersByTime(300); });
    rerender();
    act(() => { vi.advanceTimersByTime(300); });
    rerender();
    act(() => { vi.advanceTimersByTime(300); });
    rerender();
    expect(flushSpy).not.toHaveBeenCalled();

    // Let the last-scheduled debounce elapse: exactly one flush.
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });
});
