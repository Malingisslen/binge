/**
 * Pure aggregation helpers for the Insikter rollup.
 *
 * No firebase-admin imports here — these take plain arrays (already read from
 * Firestore by rollup.ts) and return aggregates, so they can be unit-tested
 * with the root Vitest toolchain (see vitest.config.ts include globs).
 */

import type { WatchStatus, MediaType } from './types';

export interface StatusDistribution {
  vill_se: number;
  mina: number;
  sedd: number;
  avbruten: number;
}

const STATUS_KEYS: WatchStatus[] = ['vill_se', 'mina', 'sedd', 'avbruten'];

/** Count watchlist items per (current-schema) status, ignoring legacy/unknown values. */
export function statusDistribution(items: { status: string }[]): StatusDistribution {
  const out: StatusDistribution = { vill_se: 0, mina: 0, sedd: 0, avbruten: 0 };
  for (const it of items) {
    if ((STATUS_KEYS as string[]).includes(it.status)) {
      out[it.status as WatchStatus] += 1;
    }
  }
  return out;
}

/** Count movie vs tv items, ignoring any unknown mediaType. */
export function mediaTypeSplit(items: { mediaType: string }[]): { movie: number; tv: number } {
  const out = { movie: 0, tv: 0 };
  for (const it of items) {
    if (it.mediaType === ('movie' satisfies MediaType)) out.movie += 1;
    else if (it.mediaType === ('tv' satisfies MediaType)) out.tv += 1;
  }
  return out;
}

/**
 * Bucket ratings into 10 buckets by rounded value: index i holds the count of
 * ratings that round to (i + 1), i.e. index 0 = rating 1 … index 9 = rating 10.
 * null and out-of-range (< 0.5 or ≥ 10.5) ratings are skipped.
 */
export function ratingsHistogram(items: { rating: number | null }[]): number[] {
  const buckets = new Array<number>(10).fill(0);
  for (const it of items) {
    if (it.rating == null || !Number.isFinite(it.rating)) continue;
    const rounded = Math.round(it.rating);
    if (rounded < 1 || rounded > 10) continue;
    buckets[rounded - 1] += 1;
  }
  return buckets;
}

/**
 * Count occurrences of each value and return the top `limit`, sorted by count
 * descending. Ties keep first-seen order (stable).
 */
export function tallyTop<T extends string | number>(
  values: T[],
  limit: number,
): { value: T; count: number }[] {
  const counts = new Map<T, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
