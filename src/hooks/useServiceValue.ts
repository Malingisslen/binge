'use client';

// BIN-182 — "Behåll eller säg upp?": assembles the monthly per-service value
// rollup from the user's watch history + their own subscription prices, via the
// pure helpers in serviceValue.ts. Films-this-month lens (keys off watchedAt;
// TV-episode hours are a follow-up — see serviceValue.ts header).

import { useMemo } from 'react';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { getProvider } from '@/lib/tmdb/providers';
import { watchedForValueFromItems, rollupServiceValue, type ServiceValueRow } from '@/lib/advisor/serviceValue';

export function useServiceValue(nowMs: number): { rows: ServiceValueRow[]; monthLabel: string } {
  const { items } = useWatchlist();
  const { user } = useAuth();

  return useMemo(() => {
    const owned = user?.myProviders ?? [];
    const now = new Date(nowMs);
    const startMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const endMs = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    const monthLabel = new Date(startMs).toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });

    const costs = user?.providerCosts ?? {};
    const watched = watchedForValueFromItems(items, owned, startMs, endMs);
    const rows = rollupServiceValue({
      watched,
      ownedProviderIds: owned,
      costFor: (id) => costs[id] ?? getProvider(id)?.defaultMonthlyCost ?? 0,
      monthStartMs: startMs,
      monthEndMs: endMs,
    });
    return { rows, monthLabel };
  }, [items, user, nowMs]);
}
