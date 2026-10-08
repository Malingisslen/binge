import { tmdbVoteFloor } from '@/lib/filters/titleFilters';
import type { FilterState } from '@/types';

type DateField = 'primary_release_date' | 'first_air_date';

/**
 * TMDB discover bounds for the year range. A row with its own default upper bound
 * (Klassiker: at least ten years old) passes it as fallbackLte; a chosen end year wins.
 */
export function discoverDateParams(
  f: Pick<FilterState, 'yearMin' | 'yearMax'>,
  field: DateField,
  fallbackLte?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.yearMin != null) out[`${field}.gte`] = `${f.yearMin}-01-01`;
  if (f.yearMax != null) out[`${field}.lte`] = `${f.yearMax}-12-31`;
  else if (fallbackLte) out[`${field}.lte`] = fallbackLte;
  return out;
}

/** Server-side pre-filter for the star floor; applyClientFilters makes the exact cut. */
export function discoverVoteParams(f: Pick<FilterState, 'minStars'>): Record<string, string> {
  const floor = tmdbVoteFloor(f.minStars);
  return floor != null ? { 'vote_average.gte': String(floor) } : {};
}

/** The filter fields a discover query depends on, for its query key. */
export const discoverKeyParts = (f: Pick<FilterState, 'yearMin' | 'yearMax' | 'minStars'>) =>
  [f.yearMin, f.yearMax, f.minStars] as const;
