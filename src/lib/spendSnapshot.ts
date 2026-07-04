import { getProvider, canonicalUniqueProviders } from '@/lib/tmdb/providers';
import { resolveEffectiveMonthlyCost } from '@/lib/advisor/effectiveCost';
import type { ProviderCampaign } from '@/lib/advisor/campaignPricing';
import type { WatchlistItem } from '@/types';

// BIN-99 — whole-watchlist streaming spend snapshot. One headline number:
// "du betalar X kr/mån, varav Y går till tjänster utan aktiv backlog." Pure +
// client-side over persisted data (myProviders, providerCosts, items.providers)
// — no TMDB calls. A provider is "active" when at least one backlog title
// (vill_se film or a followed 'mina' series) is available on it; owned paid
// services with no backlog are "idle" spend.

export interface SpendSnapshot {
  totalKr: number;
  activeKr: number;
  idleKr: number;
  idleProviders: { id: number; name: string; cost: number }[];
}

function costOf(
  id: number,
  providerCosts: Record<number, number>,
  providerTiers: Record<number, string>,
  providerCampaigns: Record<number, ProviderCampaign>,
  now: Date,
): number {
  // BIN-417: campaign-aware — a lapsed campaign auto-reverts to the ordinary price.
  return resolveEffectiveMonthlyCost(id, { providerTiers, providerCosts, providerCampaigns }, now) ?? 0;
}

export function computeSpendSnapshot(
  myProviders: number[],
  items: WatchlistItem[],
  providerCosts: Record<number, number>,
  providerTiers: Record<number, string> = {},
  // BIN-417: trailing optionals so existing callers/tests are unchanged. `now`
  // is only consulted when a campaign exists, so defaulting it is safe.
  providerCampaigns: Record<number, ProviderCampaign> = {},
  now: Date = new Date(),
): SpendSnapshot {
  // Providers that carry backlog you'd actually watch: vill_se (film) + 'mina'
  // (followed series). sedd/avbruten don't count as a reason to keep paying.
  const activeProviderIds = new Set<number>();
  for (const it of items) {
    if (it.status !== 'vill_se' && it.status !== 'mina') continue;
    for (const p of it.providers ?? []) activeProviderIds.add(p);
  }

  let totalKr = 0;
  let activeKr = 0;
  const idleProviders: { id: number; name: string; cost: number }[] = [];
  // Canonicalise + dedupe so a legacy alias+canonical pair isn't double-counted (BIN-409).
  for (const id of canonicalUniqueProviders(myProviders)) {
    const cost = costOf(id, providerCosts, providerTiers, providerCampaigns, now);
    if (cost <= 0) continue; // free services (SVT Play) aren't "spend"
    totalKr += cost;
    if (activeProviderIds.has(id)) {
      activeKr += cost;
    } else {
      idleProviders.push({ id, name: getProvider(id)?.name ?? `Tjänst ${id}`, cost });
    }
  }
  idleProviders.sort((a, b) => b.cost - a.cost); // priciest idle first
  return { totalKr, activeKr, idleKr: totalKr - activeKr, idleProviders };
}
