// BIN-402 lazy-refresh gate. The monthly tmdbFieldsSweep CLEARS a watchlist doc's
// denormalized TMDB block (title/posterPath/providers/genreIds/…) once its
// freshness stamp (`tmdbFieldsRefreshedAt`) is older than 5 months or absent
// (TMDB ToS §1.C — no caching >6mo). This is the read-side complement: when a user
// opens a title page, the page already has the fresh TMDB detail, so we re-write
// the denormalized fields + re-stamp — repopulating a swept-clean doc AND keeping a
// regularly-viewed title from ever reaching the sweep's clear threshold.
//
// Pure so it's testable without Firebase (the write itself lives in WatchlistContext).

/**
 * Refresh interval — deliberately well UNDER the sweep's 5-month clear threshold so
 * a title viewed at least this often is never swept, while a title not viewed in
 * ~3 months is allowed to age toward the sweep (and repopulates on the next view).
 */
export const TMDB_FIELDS_REFRESH_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/**
 * True when a viewed title's denormalized TMDB block should be re-written + re-
 * stamped. Absent stamp → always (never stamped, or the sweep just cleared it).
 * Otherwise only once the stamp is older than the refresh interval — so a title
 * viewed repeatedly triggers at most one write per interval, not one per view.
 */
export function needsTmdbFieldsRefresh(stamp: Date | null | undefined, now: number): boolean {
  if (!stamp) return true;
  return now - stamp.getTime() >= TMDB_FIELDS_REFRESH_INTERVAL_MS;
}

/**
 * The denormalized TMDB-derived fields a title page can re-write from the detail it
 * already fetched. All optional — the caller passes only what it has (a movie has no
 * tmdbStatus; some pages lack providers). `updatedAt` is deliberately NOT here.
 */
export interface TmdbDenormFields {
  title?: string;
  posterPath?: string | null;
  providers?: number[];
  genreIds?: number[];
  tmdbStatus?: string | null;
  runtime?: number | null;
}
