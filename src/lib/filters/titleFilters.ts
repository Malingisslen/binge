import { canonicalProviderId } from '@/lib/tmdb/providers';
import { GENRE_OPTIONS, parseGenreFilter } from '@/lib/tmdb/genreLabels';

/**
 * The filter axes Rekommendationer and Bibliotek share, so a user learns one set of
 * names and one star scale. Page-specific axes (Land, Status, Taggar) live with the page.
 */

export type AvailabilityMode = 'all' | 'mine' | 'specific';
export type LengthFilter = '' | 'film-90' | 'film-120' | 'short-episodes';

export interface SharedFilters {
  /** GENRE_OPTIONS values; a title passes when it has any of them. */
  genres: string[];
  availability: AvailabilityMode;
  /** Canonical provider ids, read only when availability is 'specific'. */
  services: number[];
  length: LengthFilter;
  /** null = open end. The slider's outer stops mean "no bound", so titles older than the floor still show. */
  yearMin: number | null;
  yearMax: number | null;
  /** 0 = every rating; otherwise 0.5–5 in half steps. */
  minStars: number;
}

export const DEFAULT_SHARED_FILTERS: SharedFilters = {
  genres: [],
  availability: 'all',
  services: [],
  length: '',
  yearMin: null,
  yearMax: null,
  minStars: 0,
};

export const YEAR_FLOOR = 1950;
/** Next year, so announced titles in Rekommendationer stay reachable. */
export const yearCeiling = (now: Date = new Date()): number => now.getFullYear() + 1;

export const LENGTH_OPTIONS: ReadonlyArray<{ value: LengthFilter; label: string }> = [
  { value: '', label: 'Alla längder' },
  { value: 'film-90', label: 'Film under 90 min' },
  { value: 'film-120', label: 'Film under 2 timmar' },
  { value: 'short-episodes', label: 'Serie, avsnitt under 30 min' },
];

export const STAR_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as const;

export const roundToHalf = (n: number): number => Math.round(n * 2) / 2;

/** TMDB scores 0–10; Binge shows every score as five stars in half steps. */
export function starsFromTmdb(voteAverage: number | null | undefined): number {
  if (!voteAverage || voteAverage <= 0) return 0;
  // Math.round(v) / 2 is roundToHalf(v / 2) without the float error of halving first.
  return Math.round(voteAverage) / 2;
}

/**
 * The TMDB vote_average.gte that lets through exactly the titles whose rounded
 * star value reaches minStars: roundToHalf(v/2) >= m  ⇔  v >= 2m − 0.5.
 */
export function tmdbVoteFloor(minStars: number): number | null {
  return minStars > 0 ? Math.max(0, minStars * 2 - 0.5) : null;
}

export const formatStars = (stars: number): string =>
  Number.isInteger(stars) ? String(stars) : stars.toFixed(1).replace('.', ',');

export const genreIdsOf = (genres: readonly string[]): number[] =>
  [...new Set(genres.flatMap(parseGenreFilter))];

export function passesGenres(titleGenreIds: readonly number[] | undefined, selectedIds: readonly number[]): boolean {
  if (selectedIds.length === 0) return true;
  return (titleGenreIds ?? []).some(id => selectedIds.includes(id));
}

/** A title with no known year fails as soon as either bound is set. */
export function passesYear(year: number | null | undefined, min: number | null, max: number | null): boolean {
  if (min == null && max == null) return true;
  if (year == null) return false;
  if (min != null && year < min) return false;
  if (max != null && year > max) return false;
  return true;
}

/**
 * runtime is minutes for a film and one episode for a series. A title whose
 * runtime is unknown fails while a length is chosen: showing it would claim it fits.
 */
export function passesLength(
  mediaType: 'movie' | 'tv',
  runtime: number | null | undefined,
  length: LengthFilter,
): boolean {
  if (!length) return true;
  if (length === 'short-episodes') return mediaType === 'tv' && runtime != null && runtime > 0 && runtime < 30;
  if (mediaType !== 'movie' || runtime == null || runtime <= 0) return false;
  return runtime < (length === 'film-90' ? 90 : 120);
}

/** The provider ids a title must be on, or null when availability does not filter. */
export function wantedProviderIds(
  f: Pick<SharedFilters, 'availability' | 'services'>,
  myProviders: readonly number[],
): number[] | null {
  // Without services of your own, "Mina tjänster" has nothing to narrow to; it filters nothing, as before.
  if (f.availability === 'mine') return myProviders.length > 0 ? [...new Set(myProviders.map(canonicalProviderId))] : null;
  if (f.availability === 'specific' && f.services.length > 0) return [...new Set(f.services.map(canonicalProviderId))];
  return null;
}

/** "Mina tjänster" saved before the user removed every service reads as "Alla", so no chip claims a filter that does nothing. */
export function withoutEmptyMine<T extends SharedFilters>(f: T, myProviders: readonly number[]): T {
  return f.availability === 'mine' && myProviders.length === 0 ? { ...f, availability: 'all' } : f;
}

/** OR across the wanted services. */
export function passesProviders(titleProviderIds: readonly number[], wanted: readonly number[] | null): boolean {
  if (wanted == null) return true;
  const set = new Set(wanted);
  return titleProviderIds.some(id => set.has(canonicalProviderId(id)));
}

export function passesStars(stars: number | null | undefined, minStars: number): boolean {
  if (minStars <= 0) return true;
  return stars != null && stars >= minStars;
}

export interface ActiveChip {
  key: string;
  label: string;
  clear: (f: SharedFilters) => SharedFilters;
}

/** One removable chip per active shared axis, in the order the panel lists them. */
export function sharedFilterChips(
  f: SharedFilters,
  serviceName: (id: number) => string,
): ActiveChip[] {
  const chips: ActiveChip[] = [];
  if (f.availability === 'mine') {
    chips.push({ key: 'availability', label: 'Mina tjänster', clear: x => ({ ...x, availability: 'all', services: [] }) });
  } else if (f.availability === 'specific' && f.services.length > 0) {
    chips.push({
      key: 'availability',
      label: f.services.map(serviceName).join(' eller '),
      clear: x => ({ ...x, availability: 'all', services: [] }),
    });
  }
  for (const g of f.genres) {
    const label = GENRE_OPTIONS.find(o => o.value === g)?.label;
    if (label) chips.push({ key: `genre-${g}`, label, clear: x => ({ ...x, genres: x.genres.filter(v => v !== g) }) });
  }
  if (f.length) {
    const label = LENGTH_OPTIONS.find(o => o.value === f.length)?.label ?? '';
    chips.push({ key: 'length', label, clear: x => ({ ...x, length: '' }) });
  }
  if (f.yearMin != null || f.yearMax != null) {
    const label = f.yearMin != null && f.yearMax != null
      ? (f.yearMin === f.yearMax ? `År ${f.yearMin}` : `År ${f.yearMin}–${f.yearMax}`)
      : f.yearMin != null ? `Från ${f.yearMin}` : `Till ${f.yearMax}`;
    chips.push({ key: 'year', label, clear: x => ({ ...x, yearMin: null, yearMax: null }) });
  }
  if (f.minStars > 0) {
    chips.push({ key: 'stars', label: `${formatStars(f.minStars)}★ eller mer`, clear: x => ({ ...x, minStars: 0 }) });
  }
  return chips;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const finiteOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;

/**
 * Reads a stored filter value back. Anything a newer or older build wrote that
 * does not fit falls back to the default for that axis, never to a crash.
 */
export function sanitizeSharedFilters(raw: unknown): SharedFilters {
  if (!isRecord(raw)) return DEFAULT_SHARED_FILTERS;
  const known = new Set(GENRE_OPTIONS.map(o => o.value));
  const genres = Array.isArray(raw.genres) ? raw.genres.filter((g): g is string => typeof g === 'string' && known.has(g)) : [];
  const availability: AvailabilityMode =
    raw.availability === 'mine' || raw.availability === 'specific' ? raw.availability : 'all';
  const services = Array.isArray(raw.services)
    ? raw.services.filter((s): s is number => typeof s === 'number' && Number.isInteger(s) && s > 0)
    : [];
  const length = LENGTH_OPTIONS.some(o => o.value === raw.length) ? raw.length as LengthFilter : '';
  let yearMin = finiteOrNull(raw.yearMin);
  let yearMax = finiteOrNull(raw.yearMax);
  if (yearMin != null && yearMax != null && yearMin > yearMax) [yearMin, yearMax] = [yearMax, yearMin];
  const minStars = typeof raw.minStars === 'number' && (STAR_STEPS as readonly number[]).includes(raw.minStars) ? raw.minStars : 0;
  return { genres, availability, services, length, yearMin, yearMax, minStars };
}

export function countSharedFilters(f: SharedFilters): number {
  return (f.availability === 'mine' || (f.availability === 'specific' && f.services.length > 0) ? 1 : 0)
    + f.genres.length
    + (f.length ? 1 : 0)
    + (f.yearMin != null || f.yearMax != null ? 1 : 0)
    + (f.minStars > 0 ? 1 : 0);
}
