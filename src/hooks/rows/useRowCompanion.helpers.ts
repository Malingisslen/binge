// Pure mapping helper for useRowCompanion, extracted so it can be tested without
// pulling React Query (and through it Firebase) into the test environment.

import type { RowTitle, TMDBMovie } from '@/types';

/**
 * Detail response → row title. The companion row is the only row that feeds a
 * DETAIL payload into the shared, list-shaped `applyClientFilters`, so every
 * field that filter reads has to be re-mapped here:
 *
 * - `genres` (detail) → `genre_ids` (list).
 * - `origin_country` — read twice by `applyClientFilters` (the country dropdown
 *   and the saved "dölj länder" setting). Left undefined, companion films were
 *   the only titles on the page that silently ignored both; and because the hub
 *   claims these films for the companion row BEFORE the row has filtered
 *   anything, an emptied row would have taken the title off the page entirely
 *   rather than releasing it back to the other rows (BIN-583).
 *
 * Older detail payloads carry only `production_countries`, hence the fallback.
 */
export function toRowTitle(m: TMDBMovie): RowTitle {
  return {
    id: m.id,
    media_type: 'movie',
    title: m.title,
    original_title: m.original_title,
    poster_path: m.poster_path,
    backdrop_path: m.backdrop_path,
    overview: m.overview,
    vote_average: m.vote_average,
    vote_count: m.vote_count,
    release_date: m.release_date,
    genre_ids: (m.genres ?? []).map(g => g.id),
    origin_country: m.origin_country ?? m.production_countries?.map(c => c.iso_3166_1),
  };
}
