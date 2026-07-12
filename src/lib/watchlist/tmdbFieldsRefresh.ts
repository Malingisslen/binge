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
 * Shared freshness predicate for every group stamp: absent stamp → true (never
 * stamped, or the sweep just cleared it); otherwise true once older than `intervalMs`
 * (inclusive). Single source of truth so the three group gates (static / providers /
 * nextair) can't drift on null-handling or boundary semantics.
 */
export function stampOlderThan(stamp: Date | null | undefined, now: number, intervalMs: number): boolean {
  if (!stamp) return true;
  return now - stamp.getTime() >= intervalMs;
}

/**
 * True when a viewed title's static TMDB block should be re-written + re-stamped —
 * at most one write per interval, not one per view.
 */
export function needsTmdbFieldsRefresh(stamp: Date | null | undefined, now: number): boolean {
  return stampOlderThan(stamp, now, TMDB_FIELDS_REFRESH_INTERVAL_MS);
}

/**
 * Providers re-check window — matches the advisor/backfill's own `providersCheckedAt`
 * staleness cutoff (60 days). BIN-468 A2: the title page writes providers only as a
 * FALLBACK — when providersCheckedAt is absent or older than this — so a build-stale
 * title-page value can never clobber (or falsely re-certify) a fresher advisor value.
 */
export const PROVIDERS_REFRESH_INTERVAL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

/**
 * True when the providers group should be (re)written from a title-page view: the
 * providersCheckedAt stamp is absent (never checked / swept clean) or older than the
 * advisor's re-check window. When false, a fresher provider attestation exists and the
 * title page must leave providers untouched.
 */
export function needsProvidersRefresh(stamp: Date | null | undefined, now: number): boolean {
  return stampOlderThan(stamp, now, PROVIDERS_REFRESH_INTERVAL_MS);
}

/**
 * Whether addItem should stamp providersCheckedAt. addItem is overloaded: a genuine
 * first add from a title page carries fresh providers, but it is ALSO the useMarkSeen
 * re-mark path, where providers are the OLD cached array (or [] from the feed). Stamping
 * then would (a) falsely re-certify stale providers to the ToS sweep and (b) suppress
 * taste/backfill's own 60-day provider re-fetch (it gates on providersCheckedAt). So
 * stamp ONLY on a genuine new add that actually carries provider data; otherwise leave
 * the stamp absent for backfill / the title-page fallback to own. (BIN-468.)
 */
export function shouldStampProvidersAtAdd(isNewAdd: boolean, providers: number[] | undefined): boolean {
  return isNewAdd && Array.isArray(providers) && providers.length > 0;
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

/** The two group stamps the title-page refresh decision reads. */
export interface TmdbRefreshStamps {
  tmdbFieldsRefreshedAt: Date | null | undefined;
  providersCheckedAt: Date | null | undefined;
}

/**
 * Pure decision for the title-page lazy-refresh (BIN-468 A2). Returns the merge
 * payload to write, or null when nothing is stale. The static group and the providers
 * group are gated INDEPENDENTLY against their OWN stamps (DBA decoupling condition):
 *  • static group (title/posterPath/genreIds/tmdbStatus/runtime + tmdbFieldsRefreshedAt)
 *    is written when tmdbFieldsRefreshedAt is stale — regardless of providers;
 *  • providers (+ providersCheckedAt) is written ONLY as a fallback, when providers are
 *    supplied AND providersCheckedAt is stale — so a fresher advisor value is never
 *    clobbered, and the title page never falsely certifies providers as freshly checked.
 * `stamp` is the serverTimestamp() sentinel. NEVER writes updatedAt.
 */
export function planTmdbFieldsRefresh(
  current: TmdbRefreshStamps,
  fields: TmdbDenormFields,
  now: number,
  stamp: unknown,
): Record<string, unknown> | null {
  const staticNeeded = needsTmdbFieldsRefresh(current.tmdbFieldsRefreshedAt, now);
  const providersNeeded = fields.providers != null && needsProvidersRefresh(current.providersCheckedAt, now);
  if (!staticNeeded && !providersNeeded) return null;

  const payload: Record<string, unknown> = {};
  if (staticNeeded) {
    payload.tmdbFieldsRefreshedAt = stamp;
    if (fields.title != null) payload.title = fields.title;
    if (fields.posterPath !== undefined) payload.posterPath = fields.posterPath;
    if (fields.genreIds != null) payload.genreIds = fields.genreIds;
    if (fields.tmdbStatus !== undefined) payload.tmdbStatus = fields.tmdbStatus;
    if (fields.runtime !== undefined) payload.runtime = fields.runtime;
  }
  if (providersNeeded) {
    payload.providers = fields.providers;
    payload.providersCheckedAt = stamp;
  }
  return payload;
}
