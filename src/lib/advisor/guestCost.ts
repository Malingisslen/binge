// Gästens summa i kalkylatorn och startsidans demo. Ren — ingen Firebase.
//
// Ingen egen prisräkning här (#28:s villkor 8): summan, "uppskattat" och paketet
// kommer ur samma kedja som Streamingrådgivaren använder för inloggade —
// summarizeMonthlySpend och detectBundleArbitrage. En gäst har ingen kampanj och
// ingen egen kostnad, så bara providerTiers skickas vidare. guestCost.test.ts
// skannar den här filen efter en egen summering.

import { summarizeMonthlySpend, isEstimatedMonthlyCost } from '@/lib/advisor/costEstimate';
import { detectBundleArbitrage, SWEDISH_BUNDLES, type BundleSuggestion, type SwedishBundle } from '@/lib/advisor/bundleArbitrage';
import type { GuestSelection } from '@/lib/guestProviders';

export interface GuestCostResult {
  totalKr: number;
  yearlyKr: number;
  paidCount: number;
  /** Minst ett belopp i summan är katalogens listpris ("Vet inte"). */
  estimated: boolean;
  /** Summans rader, ur samma kedja som summan. */
  lines: { label: string; kr: number }[];
  /** Paketet med störst besparing för exakt de valda tjänsterna, annars null. */
  bundle: BundleSuggestion | null;
  /** Minst en av tjänsterna paketet ersätter är räknad på listpris. */
  bundleEstimated: boolean;
}

export function computeGuestCost(
  selection: GuestSelection,
  now: Date,
  bundles: readonly SwedishBundle[] = SWEDISH_BUNDLES,
): GuestCostResult {
  const ids = Object.keys(selection).map(Number);
  const providerTiers: Record<number, string> = {};
  for (const id of ids) {
    const tier = selection[id];
    if (tier) providerTiers[id] = tier;
  }
  const settings = { providerTiers };

  const summary = summarizeMonthlySpend(ids, settings, now);
  const bundle = detectBundleArbitrage(ids, settings, bundles, now)[0] ?? null;
  return {
    totalKr: summary.totalKr,
    yearlyKr: summary.totalKr * 12,
    paidCount: summary.paidCount,
    estimated: summary.estimated,
    lines: summary.lines,
    bundle,
    bundleEstimated: bundle
      ? bundle.replacedProviderIds.some(id => isEstimatedMonthlyCost(id, settings, now))
      : false,
  };
}
