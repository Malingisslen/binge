import { logger } from 'firebase-functions/v2';
import type { TmdbReleaseDatesCountry } from './logic';

const BASE_URL = 'https://api.themoviedb.org/3';

/**
 * Fetch a movie's raw `/release_dates` country blocks (BIN-360). Dedicated
 * single-purpose endpoint — NOT append_to_response — mirroring
 * availableNotify/tmdb.ts's fetchSeFlatrate: 10s AbortSignal ceiling so one hung
 * TMDB call can't block the per-title fan-out loop, and null on ANY failure so
 * the caller skips the title without touching its marker (retry next run).
 * Returns [] when the film simply has no release-date data (a valid no-op).
 */
export async function fetchReleaseDates(tmdbId: number): Promise<TmdbReleaseDatesCountry[] | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) { logger.error('releaseNotify: TMDB_API_KEY not set'); return null; }
  try {
    const res = await fetch(`${BASE_URL}/movie/${tmdbId}/release_dates?api_key=${key}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) { logger.warn(`releaseNotify: TMDB /movie/${tmdbId}/release_dates → ${res.status}`); return null; }
    const json = (await res.json()) as { results?: TmdbReleaseDatesCountry[] };
    return json.results ?? [];
  } catch (err) {
    logger.warn(`releaseNotify: TMDB fetch failed for movie/${tmdbId}`, err);
    return null;
  }
}
