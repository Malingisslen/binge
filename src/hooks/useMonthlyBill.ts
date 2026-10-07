'use client';

// BIN-1449 — the monthly bill for the month before `nowMs`, from the library, the
// checked-off episodes and the pauses. The pure rollup is buildMonthlyBill.

import { useMemo } from 'react';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { useAllEpisodeProgress } from '@/hooks/useAllEpisodeProgress';
import { usePauseHistory } from '@/hooks/usePauseHistory';
import { canonicalUniqueProviders } from '@/lib/tmdb/providers';
import { resolveEffectiveMonthlyCost } from '@/lib/advisor/effectiveCost';
import { buildMonthlyBill, previousMonth, type BillPause, type MonthlyBill } from '@/lib/advisor/monthlyBill';

export function useMonthlyBill(nowMs: number): MonthlyBill | null {
  const { items } = useWatchlist();
  const { user } = useAuth();
  const { episodes, episodesLoading, episodesError } = useAllEpisodeProgress();
  const { history, isLoading: historyLoading } = usePauseHistory();

  return useMemo(() => {
    // Wait for both reads, and show nothing if the episodes could not be read: a bill
    // drawn without them would say a series service had nothing watched.
    if (episodesLoading || episodesError || historyLoading || !user) return null;
    const month = previousMonth(new Date(nowMs));
    // Priced as of the month's last day, so a campaign that ran then counts.
    const priceDate = new Date(month.endMs - 1);
    const pauses: BillPause[] = [
      ...Object.entries(user.providerPauses ?? {}).map(([id, p]) => ({ providerId: Number(id), pausedAt: p.pausedAt, resumedAt: null })),
      ...history.map(h => ({ providerId: h.providerId, pausedAt: h.pausedAt, resumedAt: h.resumedAt })),
    ];
    return buildMonthlyBill({
      items,
      episodes,
      ownedProviderIds: canonicalUniqueProviders(user.myProviders ?? []),
      costFor: (id) => resolveEffectiveMonthlyCost(id, {
        providerTiers: user.providerTiers ?? {},
        providerCosts: user.providerCosts ?? {},
        providerCampaigns: user.providerCampaigns ?? {},
      }, priceDate) ?? 0,
      pauses,
      month,
    });
  }, [items, user, episodes, episodesLoading, episodesError, history, historyLoading, nowMs]);
}
