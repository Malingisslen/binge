'use client';

// BIN-182 — "Behåll eller säg upp?": assembles the monthly per-service value
// rollup from the user's watch history + their own subscription prices, via the
// pure helpers in serviceValue.ts. Films-this-month lens (keys off watchedAt;
// TV-episode hours are a follow-up — see serviceValue.ts header).

import { useMemo } from 'react';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { canonicalUniqueProviders } from '@/lib/tmdb/providers';
import { resolveEffectiveMonthlyCost } from '@/lib/advisor/effectiveCost';
import { watchedForValueFromItems, rollupServiceValue, tvActiveProviderIdsFromItems, type ServiceValueRow } from '@/lib/advisor/serviceValue';

export function useServiceValue(nowMs: number): { rows: ServiceValueRow[]; monthLabel: string } {
  const { items } = useWatchlist();
  const { user } = useAuth();

  return useMemo(() => {
    // Canonicalise + dedupe so an alias+canonical pair isn't valued twice (BIN-409).
    const owned = canonicalUniqueProviders(user?.myProviders ?? []);
    const now = new Date(nowMs);
    const startMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const endMs = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    const monthLabel = new Date(startMs).toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });

    const costs = user?.providerCosts ?? {};
    const tiers = user?.providerTiers ?? {};
    const campaigns = user?.providerCampaigns ?? {};
    // BIN-208: only films currently marked 'sedd' count. watchedAt is set when a
    // film is marked seen but NOT cleared if it later leaves 'sedd' (merge write),
    // so gating on watchedAt alone would count un-watched films and skew the verdict.
    const seenFilms = items.filter(i => i.status === 'sedd');
    const watched = watchedForValueFromItems(seenFilms, owned, startMs, endMs);

    // BIN-513: providers carrying active TV usage — a followed series or a TV
    // will-see anchor. The value lens above is films-only, so these must be fed
    // in to stop an actively-used TV service reading as dead weight. A finished
    // 'avslutad' series is NOT active use and is excluded (see helper).
    const tvActiveProviderIds = tvActiveProviderIdsFromItems(items, owned);

    const rows = rollupServiceValue({
      watched,
      ownedProviderIds: owned,
      // BIN-417: campaign-aware; `now` is already the value-month reference date.
      costFor: (id) => resolveEffectiveMonthlyCost(id, { providerTiers: tiers, providerCosts: costs, providerCampaigns: campaigns }, now) ?? 0,
      monthStartMs: startMs,
      monthEndMs: endMs,
      tvActiveProviderIds,
    });
    return { rows, monthLabel };
  }, [items, user, nowMs]);
}
