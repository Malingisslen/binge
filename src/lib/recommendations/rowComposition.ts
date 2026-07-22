import { hasNonLatinTitle, isFromHiddenCountry } from '@/lib/utils/titleFilter';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import type { RowTitle, FilterState } from '@/types';

/**
 * Drop duplicates and any title in `excludedIds`. BIN-560 Phase 4: excludedIds is
 * keyed by the composite `mediaTypeDocId(media_type, id)`, not bare id — otherwise a
 * movie the user has seen would wrongly exclude a same-numbered TV show (the dedup
 * key one line below was already media-type-aware; the exclusion check now matches).
 */
export function dedupeAndExclude(
  items: readonly RowTitle[],
  excludedIds: ReadonlySet<string>,
): RowTitle[] {
  const seen = new Set<string>();
  const result: RowTitle[] = [];
  for (const t of items) {
    if (excludedIds.has(mediaTypeDocId(t.media_type, t.id))) continue;
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
 * How many distinct rotation windows of size `take` it takes to surface every
 * item in a pool of `poolSize`. The "blanda" button advances one window per
 * click, so this is the number of clicks-from-zero that show something new.
 */
export function rotationWindowCount(poolSize: number, take: number): number {
  if (poolSize <= 0 || take <= 0) return 0;
  return Math.ceil(poolSize / take);
}

/**
 * True once the user has rotated through the whole pool at least once — further
 * "blanda" only repeats. A pool that fits in a single window (poolSize <= take)
 * is never "tapped out": there was nothing to cycle, so the row isn't noise.
 * Drives row retirement (demoteExhaustedRows) so a fresher row rises in its place.
 */
export function isPoolExhausted(seed: number, poolSize: number, take: number): boolean {
  if (poolSize <= take) return false;
  return seed >= rotationWindowCount(poolSize, take) - 1;
}

/**
 * Stable reorder that sinks tapped-out rows to the bottom of the cascade so a
 * still-fresh row rises into the visible window. Live rows keep their original
 * (priority) order; exhausted rows keep theirs, just after the live ones.
 */
export function demoteExhaustedRows<T extends { rowKey: string }>(
  rows: readonly T[],
  exhausted: ReadonlySet<string>,
): T[] {
  const live = rows.filter(r => !exhausted.has(r.rowKey));
  const tapped = rows.filter(r => exhausted.has(r.rowKey));
  return [...live, ...tapped];
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

/** Tuning for the "Liknar {titel}" pool. See composeSimilarPool. */
export interface ComposeSimilarOpts {
  /** Trust only the top N of /recommendations — TMDB's signal decays sharply with rank. */
  recDepth: number;
  /** Trust only the top N of /similar. */
  simDepth: number;
  /**
   * Vote floor for /recommendations — kept low on purpose. TMDB's rec RANK is
   * already a quality signal (collaborative co-watch), so a niche-but-related
   * title with few votes is a good discovery, not noise. Only floors out the
   * near-zero-vote degenerates. The depth cap does the real quality work here.
   */
  recFloor: number;
  /** Vote floor for /similar — kills the catalog-dump junk (see below). */
  simFloor: number;
}

/**
 * Defaults calibrated against real TMDB data (seed "Off Campus", tv/273240):
 * - /recommendations rank 1-10 are on-theme; rank 11+ drift to "shares one broad
 *   genre" noise (Julia, Tracker, The Feed). recDepth caps the trusted head;
 *   vote count is NOT the discriminator there (the drift titles have 40-300
 *   votes) — so recFloor stays low and we trust the ranking.
 * - /similar for a thinly-tagged seed returns ~52k results dominated by 0-8 vote
 *   obscurities. simFloor removes them; simDepth bounds the rest.
 */
export const SIMILAR_POOL_DEFAULTS: ComposeSimilarOpts = {
  recDepth: 10,
  simDepth: 10,
  recFloor: 5,
  simFloor: 30,
};

/**
 * Blend TMDB /recommendations + /similar into one ranked pool, gating out the
 * low-signal tail. /recommendations is weighted above /similar at the same rank
 * (see scoreSimilarity) and trusted further down (lenient recFloor); /similar is
 * vote-floored hard to kill its catalog-dump. Both sources are depth-capped first,
 * so the pool's size reflects how many titles we actually trust — not a padded
 * 100. Callers still dedupe/exclude/filter the result.
 */
export function composeSimilarPool(
  recs: readonly RowTitle[],
  sims: readonly RowTitle[],
  opts: ComposeSimilarOpts = SIMILAR_POOL_DEFAULTS,
): RowTitle[] {
  const scored: { t: RowTitle; s: number }[] = [];
  recs.slice(0, opts.recDepth).forEach((t, i) => {
    if ((t.vote_count ?? 0) >= opts.recFloor) scored.push({ t, s: scoreSimilarity(i, 'recommendations') });
  });
  sims.slice(0, opts.simDepth).forEach((t, i) => {
    if ((t.vote_count ?? 0) >= opts.simFloor) scored.push({ t, s: scoreSimilarity(i, 'similar') });
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.map(x => x.t);
}

/** Score a title by popularity: vote_average × log(vote_count + 1). */
export function scorePopularity(item: { vote_average?: number; vote_count?: number }): number {
  return (item.vote_average ?? 0) * Math.log((item.vote_count ?? 0) + 1);
}
