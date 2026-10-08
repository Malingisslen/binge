import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// BIN-1449 — the hook's own job: wait for both reads, hand the pure rollup the
// active pauses AND the finished ones, and price the month as of its last day.

const state = {
  episodesLoading: false,
  episodesError: false,
  historyLoading: false,
  history: [] as { providerId: number; pausedAt: string; resumedAt: string }[],
  pauses: {} as Record<number, { pausedAt: string; resumeAt: string | null }>,
};
const costDates: Date[] = [];

vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => ({ items: [{ tmdbId: 1, mediaType: 'tv', status: 'tittar', providers: [8], subscriptionProviders: [8] }] }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { myProviders: [8, 76], providerPauses: state.pauses } }) }));
vi.mock('@/hooks/useAllEpisodeProgress', () => ({
  useAllEpisodeProgress: () => ({ episodes: [{ tmdbId: 1, watchedAt: new Date('2026-09-10T20:00:00') }], episodesLoading: state.episodesLoading, episodesError: state.episodesError }),
}));
vi.mock('@/hooks/usePauseHistory', () => ({ usePauseHistory: () => ({ history: state.history, isLoading: state.historyLoading }) }));
vi.mock('@/lib/advisor/effectiveCost', () => ({
  resolveEffectiveMonthlyCost: (id: number, _u: unknown, at: Date) => { costDates.push(at); return id === 8 ? 169 : 449; },
}));

import { useMonthlyBill } from './useMonthlyBill';

const NOW = new Date('2026-10-07T08:00:00').getTime();

describe('useMonthlyBill', () => {
  beforeEach(() => {
    state.episodesLoading = false;
    state.episodesError = false;
    state.historyLoading = false;
    state.history = [];
    state.pauses = {};
    costDates.length = 0;
  });

  it('bills September from an October visit, priced on the last day of September', () => {
    const { result } = renderHook(() => useMonthlyBill(NOW));
    expect(result.current?.month.name).toBe('september');
    expect(result.current?.lines.find(l => l.providerId === 8)).toMatchObject({ episodes: 1, costKr: 169 });
    expect(costDates.every(d => d.getMonth() === 8 && d.getDate() === 30)).toBe(true);
  });

  it('shows nothing while the episodes or the pause history are still loading', () => {
    state.episodesLoading = true;
    expect(renderHook(() => useMonthlyBill(NOW)).result.current).toBeNull();
    state.episodesLoading = false;
    state.historyLoading = true;
    expect(renderHook(() => useMonthlyBill(NOW)).result.current).toBeNull();
  });

  it('shows nothing when the episodes could not be read, rather than a series service with nothing watched', () => {
    state.episodesError = true;
    expect(renderHook(() => useMonthlyBill(NOW)).result.current).toBeNull();
  });

  it('counts an active pause that began before the month as paused all month', () => {
    state.pauses = { 76: { pausedAt: '2026-08-01', resumeAt: null } };
    const line = renderHook(() => useMonthlyBill(NOW)).result.current?.lines.find(l => l.providerId === 76);
    expect(line).toMatchObject({ pausedWholeMonth: true, costKr: 0 });
  });

  it('counts a finished pause from the history that covered the month', () => {
    state.history = [{ providerId: 76, pausedAt: '2026-08-01', resumedAt: '2026-10-02' }];
    const line = renderHook(() => useMonthlyBill(NOW)).result.current?.lines.find(l => l.providerId === 76);
    expect(line).toMatchObject({ pausedWholeMonth: true, costKr: 0 });
  });
});
