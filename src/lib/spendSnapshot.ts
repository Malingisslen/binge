import { subscriptionProviderIds } from '@/lib/watchlist/subscriptionProviders';
import { getProvider, canonicalUniqueProviders } from '@/lib/tmdb/providers';
import { resolveEffectiveMonthlyCost } from '@/lib/advisor/effectiveCost';
import type { ProviderCampaign } from '@/lib/advisor/campaignPricing';
import type { WatchlistItem, WatchStatus } from '@/types';

// BIN-528 — THE shared status guard for "an active reason to keep a service":
// backlog you'd actually watch — 'vill_se' (film bookmark) or 'mina' (followed
// series). 'sedd'/'avbruten' never count as a reason to keep paying. Consumed
// by all three verdict surfaces (this spend snapshot's idle-kr, the household
// dead-weight rollup, the monthly per-service value card) so their notions of
// "in use" cannot drift apart. Surface-local refinements (TV-only lens,
// 'avslutad' exclusion, canonicalisation) deliberately stay at each call site.
export function isKeepReasonStatus(status: WatchStatus): boolean {
  return status === 'vill_se' || status === 'mina';
}

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
  // Providers that carry backlog you'd actually watch (shared guard above).
  const activeProviderIds = new Set<number>();
  for (const it of items) {
    if (!isKeepReasonStatus(it.status)) continue;
    // BIN-814: the subscription subset, not the broad availability array — a title
    // you would have to RENT on a service does not make that service active spend.
    for (const p of subscriptionProviderIds(it)) activeProviderIds.add(p);
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
