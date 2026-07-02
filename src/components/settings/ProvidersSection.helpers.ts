import { canonicalProviderId, canonicalUniqueProviders, resolveProviderMonthlyCost, type SwedishProvider } from '@/lib/tmdb/providers';

/** WCAG relative luminance → pick legible foreground for a hex background. */
export function readableTextColor(hex: string): 'white' | 'ink' {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // White and dark text reach equal contrast at L = √(1.05·0.05) − 0.05 ≈ 0.179.
  const CROSSOVER = Math.sqrt(1.05 * 0.05) - 0.05;
  return L <= CROSSOVER ? 'white' : 'ink';
}

/**
 * Split a provider list into selected (in the order the user selected them)
 * and available (remaining, in source order). Matching is canonical so
 * aliases (e.g. TV4 Play 489/1944) never appear twice.
 */
export function splitProviders(
  all: SwedishProvider[],
  selectedIds: number[],
): { selected: SwedishProvider[]; available: SwedishProvider[] } {
  const canonSelected = [...new Set(selectedIds.map(canonicalProviderId))];
  const byId = new Map(all.map(p => [canonicalProviderId(p.id), p]));
  const selected = canonSelected
    .map(id => byId.get(id))
    .filter((p): p is SwedishProvider => Boolean(p));
  const selectedSet = new Set(selected.map(p => canonicalProviderId(p.id)));
  const available = all.filter(p => !selectedSet.has(canonicalProviderId(p.id)));
  return { selected, available };
}

/**
 * Sum the monthly cost across the selected provider ids, tier-first via the shared
 * resolver — so a chosen tier contributes its LIVE catalog price and the total can't
 * drift below what the advisor shows. (A tier user's frozen providerCosts entry is
 * migrated away, so summing providerCosts alone would drop them to 0.)
 */
export function totalMonthlyCost(
  selectedIds: number[],
  providerCosts: Record<number, number>,
  providerTiers: Record<number, string> = {},
): number {
  // Canonicalise + dedupe so an alias+canonical pair isn't summed twice (BIN-409).
  return canonicalUniqueProviders(selectedIds).reduce(
    (sum, id) => sum + (resolveProviderMonthlyCost(id, { providerTiers, providerCosts }) ?? 0),
    0,
  );
}
