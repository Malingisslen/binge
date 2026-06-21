/**
 * Pure aggregate-delta logic for Binge community ratings (BIN-104).
 *
 * No firebase-admin import — runs under the root Vitest suite. The maintenance
 * function fires on every watchlist write; this computes how the per-title
 * aggregate {count, sum} should change given the rating before/after the write.
 * Most writes don't touch the rating → {0, 0} (a cheap no-op).
 *
 * Ratings are the 5-star scale (0.5–5, half-steps; null = unrated). avg is
 * computed on read as sum / count; the title-page badge converts ×2 to /10 for
 * parity with TMDB. We only ever store the two running totals.
 */

export interface AggregateDelta { countDelta: number; sumDelta: number }

function asRating(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function ratingDelta(beforeRaw: unknown, afterRaw: unknown): AggregateDelta {
  const before = asRating(beforeRaw);
  const after = asRating(afterRaw);
  if (before === after) return { countDelta: 0, sumDelta: 0 };
  if (before === null) return { countDelta: 1, sumDelta: after! };          // newly rated
  if (after === null) return { countDelta: -1, sumDelta: -before };         // rating removed
  return { countDelta: 0, sumDelta: after - before };                       // rating changed
}

/** Whether a delta actually moves the aggregate (skip the write if not). */
export function isNoOp(d: AggregateDelta): boolean {
  return d.countDelta === 0 && d.sumDelta === 0;
}
