// Paket I (2026-10-05) — "uppskattat" på belopp användaren inte själv angett.
//
// Ett belopp är användarens EGET när det bygger på något hen valt: en nivå som
// fortfarande finns i katalogen, en egen kostnad, eller en kampanj som löper just
// nu. Allt annat är katalogens listpris och märks "uppskattat" — även en vald nivå
// som katalogen tagit bort, eftersom resolveProviderMonthlyCost då tyst faller
// tillbaka på listpriset. En gratistjänst (0 kr) är aldrig en uppskattning.
//
// Summan i summarizeMonthlySpend går genom computeSpendSnapshot.

import { getProvider } from '@/lib/tmdb/providers';
import { resolveEffectiveMonthlyCost, type CampaignCostSettings } from '@/lib/advisor/effectiveCost';
import { resolveCampaignCost } from '@/lib/advisor/campaignPricing';
import { computeSpendSnapshot } from '@/lib/spendSnapshot';

export function isEstimatedMonthlyCost(
  providerId: number,
  user: CampaignCostSettings,
  now: Date,
): boolean {
  const provider = getProvider(providerId);
  if (!provider) return false;
  const effective = resolveEffectiveMonthlyCost(providerId, user, now);
  if (effective == null || effective <= 0) return false;

  const key = provider.id;
  const tierId = user.providerTiers?.[key];
  if (tierId && provider.tiers?.some(t => t.id === tierId)) return false;
  if (user.providerCosts?.[key] != null) return false;
  const campaign = user.providerCampaigns?.[key];
  if (resolveCampaignCost(campaign, effective, now).isCampaignActive) return false;
  return true;
}

export interface MonthlySpendSummary {
  totalKr: number;
  /** Tjänster som kostar mer än 0 kr — samma urval som summan. */
  paidCount: number;
  /** Minst ett av beloppen i summan är katalogens listpris. */
  estimated: boolean;
}

export function summarizeMonthlySpend(
  myProviders: number[],
  user: CampaignCostSettings,
  now: Date,
): MonthlySpendSummary {
  const snapshot = computeSpendSnapshot(
    myProviders,
    [],
    user.providerCosts ?? {},
    user.providerTiers ?? {},
    user.providerCampaigns ?? {},
    now,
  );
  // Utan titlar är varje betald tjänst "idle", så listan är exakt summans urval.
  const counted = snapshot.idleProviders;
  return {
    totalKr: snapshot.totalKr,
    paidCount: counted.length,
    estimated: counted.some(p => isEstimatedMonthlyCost(p.id, user, now)),
  };
}
