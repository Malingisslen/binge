/**
 * Pure logic for the "släpps idag" digital-release push (BIN-360).
 *
 * No firebase-admin / firebase-functions import — runs under the root Vitest
 * suite (see reference_functions_test_import: root `npm ci` lacks firebase-admin,
 * so anything root-tested must be import-free of it).
 *
 * The release-day push fires when a film the user has "bevakat" (movie in vill_se)
 * reaches its Swedish DIGITAL release date (TMDB release type 4, region SE),
 * independent of whether it lands on a service the user subscribes to.
 */

/** One dated release entry within a country block of TMDB's /release_dates. */
export interface TmdbReleaseDate {
  /** TMDB release type: 1=Premiere, 2=Theatrical(limited), 3=Theatrical, 4=Digital, 5=Physical, 6=TV. */
  type: number;
  /** Full ISO datetime, e.g. "2026-07-11T00:00:00.000Z". */
  release_date: string;
}

/** A country block from TMDB's /release_dates `results`. */
export interface TmdbReleaseDatesCountry {
  iso_3166_1: string;
  release_dates: TmdbReleaseDate[];
}

/** TMDB release type 4 = Digital (streaming/rent/buy availability date). */
export const RELEASE_TYPE_DIGITAL = 4;

/**
 * All SE digital (type-4) release dates as their STATED calendar day `YYYY-MM-DD`,
 * deduped. TMDB can list several type-4 entries for one film (different
 * contributors / re-releases), so we collect ALL of them — the caller matches
 * against any, never just `[0]`. Zero SE / zero type-4 entries → empty array (a
 * legitimate no-op, not an error).
 *
 * A TMDB release_date is semantically a CALENDAR DATE (the time component is
 * usually 00:00 and is noise when non-zero), so we take the stated date part
 * directly — NOT a timezone conversion of the instant. The caller compares this
 * stated date against Sweden's CURRENT calendar day (`stockholmDateString(now)`),
 * i.e. "fire when Sweden's today reaches TMDB's stated release date". Converting
 * the release_date itself through a timezone would wrongly roll a `22:00Z` entry
 * (whose intended date is that day) to the next day.
 */
export function seDigitalReleaseDates(results: TmdbReleaseDatesCountry[] | null | undefined): string[] {
  const se = results?.find((r) => r.iso_3166_1 === 'SE');
  if (!se || !Array.isArray(se.release_dates)) return [];
  const dates = new Set<string>();
  for (const rd of se.release_dates) {
    if (rd?.type === RELEASE_TYPE_DIGITAL && typeof rd.release_date === 'string' && rd.release_date.length >= 10) {
      dates.add(rd.release_date.slice(0, 10));
    }
  }
  return [...dates];
}

/**
 * True if the film releases digitally in SE on `today` (YYYY-MM-DD). Fires if
 * ANY type-4 SE entry equals today (multiple entries are OR-matched); zero
 * entries → false. Retained for the exact-day tests; the scheduler now fires via
 * the grace-window {@link releaseDateToFire} (BIN-464) so a missed cron day still
 * catches up.
 */
export function releasesDigitallyToday(
  results: TmdbReleaseDatesCountry[] | null | undefined,
  today: string,
): boolean {
  return seDigitalReleaseDates(results).includes(today);
}

// ---------------------------------------------------------------------------
// BIN-463 — release-date CACHE + BIN-464 — catch-up window & per-user dedup.
// Pure (no firebase-admin) so the root Vitest suite can prove the decisions.
// ---------------------------------------------------------------------------

/**
 * How long a resolved SE-digital-date list stays trusted before the scheduler
 * re-hits TMDB (BIN-463). A vill_se film's `/release_dates` is otherwise fetched
 * on EVERY daily run; caching the resolved dates for this window collapses that
 * to roughly one fetch per title per TTL. Kept short so a shifted/added digital
 * date is still discovered within a couple of days.
 */
export const RELEASE_REFETCH_TTL_DAYS = 2;

/**
 * Catch-up grace (BIN-464): a film still fires "släpps idag" for up to this many
 * days AFTER its SE digital date, so a missed cron run (or a date only discovered
 * on the next TTL refetch) is not lost forever. Chosen ≥ the TTL so a date that
 * first appears at a refetch is always still inside the fire window. The per-user
 * marker guarantees at-most-one push across the whole window.
 */
export const RELEASE_CATCHUP_GRACE_DAYS = 3;

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` → ms at UTC midnight. Calendar arithmetic only — never a TZ shift. */
export function ymdToUtcMs(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00.000Z`);
}

/** Whole-day difference `to − from` for two `YYYY-MM-DD` calendar strings. */
export function dayDiff(fromYmd: string, toYmd: string): number {
  return Math.round((ymdToUtcMs(toYmd) - ymdToUtcMs(fromYmd)) / MS_PER_DAY);
}

/** Cached per-title release-date state (BIN-463), as read back from Firestore. */
export interface ReleaseDateCache {
  /** Resolved SE type-4 dates (`YYYY-MM-DD`); `[]` = film has no SE digital date. */
  seDigitalDates: string[];
  /** When the cache was last resolved from TMDB, in epoch ms; null = never. */
  datesResolvedAtMs: number | null;
}

/**
 * Whether the scheduler must re-fetch `/release_dates` from TMDB this run, or may
 * trust the cache (BIN-463). Re-fetch when: no cache / never resolved; the cache
 * is older than the TTL; the stamp is in the future (clock skew — distrust); OR a
 * cached date sits inside the fire window, where we always confirm against live
 * TMDB before pushing (a date can shift). Otherwise the film is clearly not near
 * release and we skip the fetch entirely.
 */
export function shouldRefetchReleaseDates(
  cache: ReleaseDateCache | null,
  today: string,
  nowMs: number,
  opts: { ttlDays: number; graceDays: number } = {
    ttlDays: RELEASE_REFETCH_TTL_DAYS,
    graceDays: RELEASE_CATCHUP_GRACE_DAYS,
  },
): boolean {
  if (!cache || cache.datesResolvedAtMs === null) return true;
  const ageMs = nowMs - cache.datesResolvedAtMs;
  if (ageMs < 0) return true;                       // future stamp → distrust
  if (ageMs >= opts.ttlDays * MS_PER_DAY) return true;
  // A cached date near/at release → confirm live before we ever fire.
  return cache.seDigitalDates.some((d) => isWithinFireWindow(d, today, opts.graceDays));
}

/** True if `today` is on `releaseDate` or up to `graceDays` after it. */
export function isWithinFireWindow(releaseDate: string, today: string, graceDays: number): boolean {
  const diff = dayDiff(releaseDate, today);         // today − releaseDate
  return diff >= 0 && diff <= graceDays;
}

/**
 * The SE digital date to fire on today, or null if none is in the window. Among
 * the fireable dates (today, or up to `graceDays` ago) picks the LATEST — so a
 * film that gained a newer digital date fires for that fresh event, and the value
 * doubles as the per-user dedup key (BIN-464).
 */
export function releaseDateToFire(
  seDigitalDates: string[],
  today: string,
  graceDays: number = RELEASE_CATCHUP_GRACE_DAYS,
): string | null {
  let best: string | null = null;
  for (const d of seDigitalDates) {
    if (isWithinFireWindow(d, today, graceDays) && (best === null || d > best)) best = d;
  }
  return best;
}

/**
 * Per-user dedup (BIN-464): push only if we have NOT already notified this user
 * for this exact release date. A newer date (a re-release / added digital date)
 * re-arms because `notifiedDate` no longer equals `dateToFire`. Replaces the old
 * "does the deletable inbox card still exist?" check, which re-fired whenever the
 * user cleared their inbox.
 */
export function shouldNotifyRelease(notifiedDate: string | null | undefined, dateToFire: string): boolean {
  return notifiedDate !== dateToFire;
}

/**
 * `YYYY-MM-DD` calendar date in Europe/Stockholm for the given instant. Uses Intl
 * with an explicit timeZone so the DST offset is always correct — the "today"
 * boundary must be Sweden's local midnight, not UTC's (a UTC-date comparison
 * would fire a day early/late for ~1-2h around midnight). sv-SE renders ISO order.
 */
export function stockholmDateString(now: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
