// BIN-354 — pure stats over a title's captured rent-price history.
//
// The points come from priceHistory/{tmdbId}.points (BIN-180), appended
// write-on-change by the streamingOffersRefresh cron, so they're sparse. This
// helper turns them into the "Nu / Lägst / Högst" stat row (option C) the title
// page renders. Pure (no Firebase) so it's unit-testable.

export interface PricePoint {
  at: number;       // epoch ms (capture time)
  amount: number;   // cheapest rent price at that time
  currency: string;
}

export interface PriceStats {
  current: number;   // most recent captured price
  lowest: number;    // lowest within the window (or all-time fallback)
  highest: number;   // highest within the window (or all-time fallback)
  currency: string;
  /** % below the window high (0 when current/flat). For the "▼ N% från högsta" line. */
  dropFromHighPct: number;
  /** Whether the current price equals the window low (a "lowest seen" moment). */
  atLowest: boolean;
  /** True when ≥1 point fell inside the window (so a "senaste N mån"-label is honest). */
  windowed: boolean;
  /** Points used for the sparkline (windowed, or all when the window is empty). */
  points: PricePoint[];
}

const DAY_MS = 86_400_000;

/**
 * Reduce sparse price points to the stat row. Returns null when there's no data
 * to show. `windowDays` scopes lowest/highest (e.g. 180 = "senaste 6 mån"); if
 * no points fall inside the window we fall back to ALL points so the row is
 * still meaningful (and the caller can label it accordingly). `current` is
 * always the most recent point overall.
 */
export function computePriceStats(
  points: PricePoint[] | undefined | null,
  windowDays: number,
  nowMs: number,
): PriceStats | null {
  if (!points || points.length === 0) return null;
  const cutoff = nowMs - windowDays * DAY_MS;
  const windowed = points.filter(p => p.at >= cutoff);
  const used = windowed.length > 0 ? windowed : points;

  const last = points[points.length - 1];
  const current = last.amount;
  const currency = last.currency;
  const amounts = used.map(p => p.amount);
  const lowest = Math.min(...amounts);
  const highest = Math.max(...amounts);
  const dropFromHighPct = highest > 0 ? Math.round((1 - lowest / highest) * 100) : 0;

  return {
    current,
    lowest,
    highest,
    currency,
    dropFromHighPct,
    atLowest: current === lowest,
    windowed: windowed.length > 0,
    points: used,
  };
}

/**
 * Build a normalized 0..1 polyline (oldest→newest) for a sparkline. Returns an
 * array of {x, y} in [0,1] where y=0 is the cheapest and y=1 the most expensive,
 * so the consumer can map to any viewBox. Returns [] for <2 points (nothing to
 * draw a line between).
 */
export function sparklinePoints(points: PricePoint[]): { x: number; y: number }[] {
  if (points.length < 2) return [];
  const amounts = points.map(p => p.amount);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const span = max - min;
  const n = points.length - 1;
  return points.map((p, i) => ({
    x: i / n,
    y: span === 0 ? 0.5 : (p.amount - min) / span,
  }));
}
