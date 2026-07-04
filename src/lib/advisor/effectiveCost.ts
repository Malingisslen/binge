// BIN-417 — the campaign-aware single source of truth for "what does THIS user
// pay per month for this provider, right now". Composes the two already-shipped,
// tested pieces without either knowing about the other:
//   1. resolveProviderMonthlyCost (providers.ts) — the ORDINARY price
//      (chosen tier → custom cost → catalog default).
//   2. resolveCampaignCost (campaignPricing.ts, BIN-396) — a raw stored campaign
//      that applies through its inclusive endDate then AUTO-REVERTS to ordinary.
//
// This is the keystone the BIN-417 cost-cascade wiring hangs off: every advisor /
// spend surface that today calls resolveProviderMonthlyCost should call THIS
// instead (passing an injected `now`) so a lapsed campaign can never keep quoting
// the promo price. Kept in lib/advisor (not lib/tmdb) so providers.ts stays free
// of any advisor/campaign dependency — the composition points the other way.
//
// Persistence contract (role #28, from the BIN-396 module header): the stored
// campaign is the RAW input { monthlyCost, endDate } — NEVER a pre-resolved
// effectiveMonthlyCost snapshot. Resolving the effective value here, at read
// time against `now`, is the whole point; caching it at write time would
// reintroduce the staleness bug the feature exists to remove.

import { resolveProviderMonthlyCost, canonicalProviderId } from '@/lib/tmdb/providers';
import { resolveCampaignCost, type ProviderCampaign } from '@/lib/advisor/campaignPricing';

export interface CampaignCostSettings {
  providerTiers?: Record<number, string>;
  providerCosts?: Record<number, number>;
  /** Raw per-provider campaign input, keyed by CANONICAL provider id (same as
   *  providerTiers/providerCosts). Optional third case — distinct from
   *  providerCosts, which stays unambiguously "egen ordinarie kostnad". */
  providerCampaigns?: Record<number, ProviderCampaign>;
}

/**
 * The effective monthly cost a user pays for a provider at `now`: the campaign
 * price while its campaign is active, else the ordinary resolved price. Returns
 * null ONLY when the ordinary cost is unknown (unknown provider, or no cost known
 * anywhere) — a campaign can never manufacture a cost out of nothing, since it
 * needs an ordinary price to revert to. `now` is required + injected (never
 * defaulted) so results are deterministic, matching resolveCampaignCost.
 */
export function resolveEffectiveMonthlyCost(
  providerId: number,
  user: CampaignCostSettings,
  now: Date,
): number | null {
  const ordinary = resolveProviderMonthlyCost(providerId, user);
  if (ordinary == null) return null;
  // Canonicalise the campaign lookup so an alias id (e.g. 531 → 431) resolves the
  // same stored campaign — identical to how resolveProviderMonthlyCost keys.
  const campaign = user.providerCampaigns?.[canonicalProviderId(providerId)];
  return resolveCampaignCost(campaign, ordinary, now).effectiveMonthlyCost;
}
