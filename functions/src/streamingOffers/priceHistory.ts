// BIN-180 — price-history capture. On each offers refresh we snapshot the
// cheapest rent price into a shared, global priceHistory/{tmdbId} doc
// (write-on-change only). TMDB/JustWatch give only *current* offers; this builds
// the history asset Binge can't backfill — so capture must start early.
//
// Pure helpers (no firebase-admin) — unit-tested under the root Vitest suite.

import type { Offer } from './types';

export interface PricePoint {
  at: number;       // epoch ms (capture time)
  amount: number;   // cheapest rent price
  currency: string;
}

// Cap the points array so a per-title doc can't grow unbounded over years of
// daily runs. Write-on-change already keeps it sparse; this is a hard backstop.
export const MAX_POINTS = 400;

// Lowest rent offer with a concrete price. Rent (not buy) is the "is it cheap to
// watch tonight" signal the graph/alerts care about. Returns null when nothing
// is rentable with a known price.
export function cheapestRent(offers: Offer[]): { amount: number; currency: string } | null {
  let best: { amount: number; currency: string } | null = null;
  for (const o of offers) {
    if (o.type !== 'rent' || o.priceAmount == null) continue;
    if (best === null || o.priceAmount < best.amount) {
      best = { amount: o.priceAmount, currency: o.priceCurrency ?? 'SEK' };
    }
  }
  return best;
}

// Append a point only when the cheapest rent price actually changed vs the last
// recorded point (write-on-change — never one point per run). Returns the new,
// capped points array, or null when nothing should be written.
export function appendPricePoint(
  points: PricePoint[],
  current: { amount: number; currency: string } | null,
  atMs: number,
): PricePoint[] | null {
  if (current === null) return null;
  const last = points[points.length - 1];
  if (last && last.amount === current.amount && last.currency === current.currency) return null;
  const next = [...points, { at: atMs, amount: current.amount, currency: current.currency }];
  return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
}
