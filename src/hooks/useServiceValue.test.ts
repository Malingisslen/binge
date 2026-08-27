import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// BIN-1027 — the call site, not the helper.
//
// BIN-1008 moved "counts as seen right now" into `src/lib/markedSeen.ts` and gave it a
// suite. What it did NOT do is guard the three places that CALL it: swapping
// `markedSeen(items)` back to `items.filter(i => seenDate(i) != null)` here reddens
// nothing, because the helper's suite tests the helper.
//
// And this call site is the one an end-to-end test cannot catch. `watchedForValueFromItems`
// drops rows without `watchedAt` on its own, so the money that comes out the far end is
// identical under either spelling — the ticket says so, and it is right. The only place the
// difference is observable is the SET handed across that boundary, so that is what this
// asserts.

const watchedForValueFromItems = vi.fn((...args: unknown[]): unknown[] => { void args; return []; });
const tvActiveProviderIdsFromItems = vi.fn(() => new Set<number>());
const rollupServiceValue = vi.fn(() => []);

vi.mock('@/lib/advisor/serviceValue', () => ({
  watchedForValueFromItems: (...args: unknown[]) => watchedForValueFromItems(...(args as [])),
  tvActiveProviderIdsFromItems: (...args: unknown[]) => tvActiveProviderIdsFromItems(...(args as [])),
  rollupServiceValue: (...args: unknown[]) => rollupServiceValue(...(args as [])),
}));

const items: unknown[] = [];
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => ({ items }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { myProviders: [8] } }) }));
vi.mock('@/lib/advisor/effectiveCost', () => ({ resolveEffectiveMonthlyCost: () => 109 }));

import { useServiceValue } from './useServiceValue';

const title = (over: Record<string, unknown>) => ({
  tmdbId: 1,
  mediaType: 'movie',
  status: 'sedd',
  watchedAt: null,
  dropped: false,
  rating: null,
  subscriptionProviders: [8],
  ...over,
});

beforeEach(() => {
  items.length = 0;
  watchedForValueFromItems.mockClear();
});

describe('useServiceValue feeds the value lens the MARKED-SEEN set (BIN-1027)', () => {
  it('passes a sedd film that has no watchedAt', () => {
    // The decisive row. `watchedAt` is set when a film is marked seen and NOT cleared if
    // it later leaves 'sedd', so the date is neither necessary nor sufficient — the status
    // is the rule. A date filter at this call site would drop this title before the lens
    // ever saw it, and no assertion on kronor could tell.
    const undated = title({ tmdbId: 42, watchedAt: null });
    items.push(undated);

    renderHook(() => useServiceValue(Date.UTC(2026, 7, 15)));

    expect(watchedForValueFromItems).toHaveBeenCalledTimes(1);
    expect(watchedForValueFromItems.mock.calls[0]![0]).toEqual([undated]);
  });

  it('does NOT pass a title that merely carries a date', () => {
    // The other half of the same rule, and the reason it is not enough to assert a count:
    // a dropped title with a stale `watchedAt` is exactly what a date filter would let in.
    const dropped = title({ tmdbId: 43, status: 'avbruten', watchedAt: new Date('2026-08-01') });
    items.push(dropped);

    renderHook(() => useServiceValue(Date.UTC(2026, 7, 15)));

    expect(watchedForValueFromItems.mock.calls[0]![0]).toEqual([]);
  });

  it('control — an ordinary sedd film WITH a date is still passed', () => {
    // Without this the two rows above would pass on a call site that hands the lens
    // nothing at all.
    const dated = title({ tmdbId: 44, watchedAt: new Date('2026-08-02') });
    items.push(dated);

    renderHook(() => useServiceValue(Date.UTC(2026, 7, 15)));

    expect(watchedForValueFromItems.mock.calls[0]![0]).toEqual([dated]);
  });
});
