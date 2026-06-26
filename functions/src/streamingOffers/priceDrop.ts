// BIN-180 — price-drop detection over the captured priceHistory points.
//
// priceHistory.ts writes a point ONLY when the cheapest rent price changes
// (write-on-change), so the last point being lower than the one before it means
// a real drop happened at `last.at`. The daily notify scan alerts on a *fresh*
// drop (within `freshnessMs`) so we ping near the event, and the dedup marker
// (priceDropNotifyState/{tmdbId}) guarantees at-most-once per distinct drop.
//
// Pure (no firebase-admin) — unit-tested under the root Vitest suite alongside
// priceHistory.test.ts.

import type { PricePoint } from './priceHistory';

export interface PriceDropSignal {
  amount: number;          // the new (lower) cheapest rent price
  currency: string;
  previousAmount: number;  // the price it dropped from
  /** True when `amount` is the lowest within the lookback window (for "lägsta på 6 mån" copy). */
  isMultiMonthLow: boolean;
}

const TWO_DAYS_MS = 2 * 86_400_000;
const SIX_MONTHS_MS = 180 * 86_400_000;

export function detectPriceDrop(
  points: readonly PricePoint[],
  opts: { nowMs: number; freshnessMs?: number; lowWindowMs?: number },
): PriceDropSignal | null {
  if (points.length < 2) return null;
  const freshnessMs = opts.freshnessMs ?? TWO_DAYS_MS;
  const lowWindowMs = opts.lowWindowMs ?? SIX_MONTHS_MS;

  const last = points[points.length - 1];
  const prev = points[points.length - 2];

  // Only a price *decrease* counts, and only currency-comparable points.
  if (last.currency !== prev.currency) return null;
  if (last.amount >= prev.amount) return null;
  // Only a fresh drop — the daily scan alerts near the event, not for ancient history.
  if (opts.nowMs - last.at > freshnessMs) return null;

  // New low? Compare against every other point inside the lookback window.
  const windowStart = opts.nowMs - lowWindowMs;
  const isMultiMonthLow = points
    .slice(0, -1)
    .filter(p => p.at >= windowStart && p.currency === last.currency)
    .every(p => last.amount < p.amount);

  return {
    amount: last.amount,
    currency: last.currency,
    previousAmount: prev.amount,
    isMultiMonthLow,
  };
}
