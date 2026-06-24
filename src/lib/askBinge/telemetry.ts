// BIN-176 — Fråga Binge usage/error telemetry, PII-free.
//
// The whole point: today a search that parses fine but returns an empty grid is
// indistinguishable from a happy one, so we are blind to our most common silent
// failure. These helpers derive Plausible event props that are pure shapes —
// bucketed counts and fixed filter-type names — never the user's raw sentence.
// See analytics.ts ('ask_binge_results' / 'ask_binge_submitted' /
// 'ask_binge_chip_removed').

import type { AskFilter } from './types';

export type ResultBucket = '0' | '1-9' | '10-29' | '30+';

/** Bucket the result count; 0 is its own bucket so zero-result searches are visible. */
export function resultBucket(n: number): ResultBucket {
  if (n <= 0) return '0';
  if (n < 10) return '1-9';
  if (n < 30) return '10-29';
  return '30+';
}

export function mediaFilterOf(filter: AskFilter): 'all' | 'movie' | 'tv' {
  return filter.mediaType ?? 'all';
}

// Filter TYPES (not values) the parse activated. Media type is the scope, not a
// filter here — it rides on mediaFilterOf instead. Sorted + '+'-joined so a single
// Plausible property value captures which COMBINATIONS strand users.
const FILTER_TYPES: [keyof AskFilter, string][] = [
  ['genreIds', 'genre'],
  ['mood', 'mood'],
  ['runtimeMax', 'runtime'],
  ['providerIds', 'provider'],
  ['myProvidersOnly', 'myProviders'],
  ['excludeSeen', 'excludeSeen'],
  ['voteAverageMin', 'rating'],
  ['decade', 'decade'],
  ['originalLanguage', 'language'],
  ['sortBy', 'sort'],
];

export function activeFilterSummary(filter: AskFilter): string {
  const active = FILTER_TYPES.filter(([key]) => {
    const v = filter[key];
    return Array.isArray(v) ? v.length > 0 : v != null && v !== false;
  }).map(([, name]) => name);
  return active.length ? active.sort().join('+') : 'none';
}
