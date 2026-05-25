import { hasNonLatinTitle, isFromHiddenCountry } from '@/lib/utils/titleFilter';
import type { RowTitle, FilterState } from '@/types';

/** Drop duplicates and any title whose id is in `excludedIds`. */
export function dedupeAndExclude(
  items: readonly RowTitle[],
  excludedIds: ReadonlySet<number>,
): RowTitle[] {
  const seen = new Set<string>();
  const result: RowTitle[] = [];
  for (const t of items) {
    if (excludedIds.has(t.id)) continue;
    const key = `${t.media_type}-${t.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(t);
  }
  return result;
}

/** First `cap` are "visible", remainder is the backing pool used to fill gaps. */
export function splitVisibleAndPool(
  items: readonly RowTitle[],
  cap: number,
): { visible: RowTitle[]; backingPool: RowTitle[] } {
  return {
    visible: items.slice(0, cap),
    backingPool: items.slice(cap),
  };
}

/** Strip diacritics for searches (so "mork" matches "Mörk"). */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function containsSearchText(
  title: string | undefined,
  originalTitle: string | undefined | null,
  query: string,
): boolean {
  if (!query) return true;
  const q = normalize(query);
  if (title && normalize(title).includes(q)) return true;
  if (originalTitle && normalize(originalTitle).includes(q)) return true;
  return false;
}

function decadeOf(releaseDate: string | null | undefined): string | null {
  if (!releaseDate) return null;
  const year = Number(releaseDate.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return String(Math.floor(year / 10) * 10);
}

/**
 * Apply page-level filters to a row's pool.
 * Note: provider filtering (myProvidersOnly) requires per-title provider data
 * which is not on TMDBSearchResult — that's handled separately in the row hook
 * via useSearchProviders.
 */
export function applyClientFilters(
  items: readonly RowTitle[],
  filters: FilterState,
): RowTitle[] {
  const genreId = filters.genre ? Number(filters.genre) : null;
  return items.filter(t => {
    if (filters.mediaType !== 'all' && t.media_type !== filters.mediaType) return false;
    if (filters.hideNonLatinTitles) {
      const tn = t as RowTitle & { name?: string; original_name?: string };
      if (hasNonLatinTitle(t.title ?? tn.name, t.original_title ?? tn.original_name)) return false;
    }
    if (filters.hiddenCountries.length && isFromHiddenCountry(t.origin_country, [...filters.hiddenCountries])) return false;
    if (genreId !== null && !(t.genre_ids ?? []).includes(genreId)) return false;
    if (filters.country) {
      const oc = t.origin_country ?? [];
      if (!oc.includes(filters.country)) return false;
    }
    if (filters.decade) {
      const tWithFirstAir = t as RowTitle & { first_air_date?: string };
      if (decadeOf(t.release_date ?? tWithFirstAir.first_air_date) !== filters.decade) {
        return false;
      }
    }
    if (filters.voteAverageMin > 0) {
      if ((t.vote_average ?? 0) < filters.voteAverageMin) return false;
    }
    if (filters.searchText) {
      const tWithName = t as RowTitle & { name?: string; original_name?: string };
      if (!containsSearchText(t.title ?? tWithName.name, t.original_title ?? tWithName.original_name, filters.searchText)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Roterar ett window av storlek `take` ur `items`, offsettat med `seed * take`,
 * med wraparound. Används för per-rad "visa nya förslag"-knappen — låter oss
 * visa olika titlar ur en redan-hämtad pool utan ny TMDB-trafik.
 */
export function rotatePool<T>(items: readonly T[], seed: number, take: number): T[] {
  if (items.length === 0 || take <= 0) return [];
  if (items.length <= take) return [...items];
  const len = items.length;
  const offset = ((seed * take) % len + len) % len;
  const end = offset + take;
  if (end <= len) return items.slice(offset, end);
  return [...items.slice(offset), ...items.slice(0, end - len)];
}

/**
 * Score for the rad-1 similarity ranking. Lower index = higher score; /recommendations
 * is treated as more authoritative than /similar.
 */
export function scoreSimilarity(
  index: number,
  source: 'recommendations' | 'similar',
): number {
  const base = 1 / (index + 1);
  return source === 'recommendations' ? base * 1.5 : base;
}

/** Score a title by popularity: vote_average × log(vote_count + 1). */
export function scorePopularity(item: { vote_average?: number; vote_count?: number }): number {
  return (item.vote_average ?? 0) * Math.log((item.vote_count ?? 0) + 1);
}
