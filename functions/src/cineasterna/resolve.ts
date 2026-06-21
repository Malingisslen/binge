// functions/src/cineasterna/resolve.ts
import { logger } from 'firebase-functions/v2';

const BASE = 'https://api.themoviedb.org/3';

/**
 * Resolve an IMDb id to a TMDB *movie* id (Cineasterna is film-only).
 *
 * Return values:
 *   number      — resolved successfully
 *   'NOT_FOUND' — request OK but no movie_results entry → genuinely absent from TMDB (terminal)
 *   null        — transient error (missing key, non-ok HTTP, network/parse fault) → should be retried
 */
export async function resolveTmdbId(imdbId: string): Promise<number | 'NOT_FOUND' | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) { logger.error('cineasterna: TMDB_API_KEY not set'); return null; }
  try {
    const params = new URLSearchParams({ api_key: key, external_source: 'imdb_id' });
    const res = await fetch(`${BASE}/find/${imdbId}?${params.toString()}`);
    if (!res.ok) { logger.warn(`cineasterna: TMDB /find ${imdbId} -> ${res.status}`); return null; }
    const json = await res.json() as Record<string, unknown>;
    const results = Array.isArray(json['movie_results']) ? json['movie_results'] as Record<string, unknown>[] : null;
    const movie = results?.[0] ?? null;
    if (!movie) return 'NOT_FOUND';
    return typeof movie['id'] === 'number' ? movie['id'] : null;
  } catch (err) {
    logger.warn(`cineasterna: TMDB /find failed for ${imdbId}`, err);
    return null;
  }
}
