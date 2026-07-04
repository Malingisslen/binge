// BIN-417 Phase B — the "din kampanj löper ut snart" money-nudge rollup for the
// advisor surface. Pure + testable: given the user's stored campaigns + their
// cost settings, it returns one row per provider whose campaign is active, ends
// within the window, AND rises by ≥1 kr (campaignExpiryNudge's own guard). The
// ORDINARY price (resolveProviderMonthlyCost, not the effective one) is what the
// nudge compares against — that's the price the user will actually pay after the
// promo, and the jump they need to be warned about.

import { getProvider, resolveProviderMonthlyCost } from '@/lib/tmdb/providers';
import {
  campaignExpiryNudge,
  type CampaignExpiryNudge,
  type ProviderCampaign,
} from '@/lib/advisor/campaignPricing';

export interface CampaignNudgeRow {
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  nudge: CampaignExpiryNudge;
}

export function computeCampaignNudges(
  providerCampaigns: Record<number, ProviderCampaign> | undefined,
  cost: { providerTiers?: Record<number, string>; providerCosts?: Record<number, number> },
  now: Date,
  warnWithinDays = 7,
): CampaignNudgeRow[] {
  if (!providerCampaigns) return [];
  const rows: CampaignNudgeRow[] = [];
  for (const [idStr, campaign] of Object.entries(providerCampaigns)) {
    const providerId = Number(idStr);
    const provider = getProvider(providerId);
    if (!provider) continue;
    // Ordinary (post-campaign) price — what the user reverts to. campaignExpiryNudge
    // is null unless the campaign is active, ending within the window, and this is
    // ≥1 kr above the campaign price.
    const ordinary = resolveProviderMonthlyCost(providerId, cost);
    if (ordinary == null) continue;
    const nudge = campaignExpiryNudge(campaign, ordinary, now, warnWithinDays);
    if (!nudge) continue;
    rows.push({
      providerId,
      providerName: provider.name,
      shortName: provider.shortName,
      color: provider.color,
      nudge,
    });
  }
  // Most urgent first (soonest expiry).
  rows.sort((a, b) => a.nudge.daysUntilEnd - b.nudge.daysUntilEnd);
  return rows;
}
