import { logger } from 'firebase-functions/v2';

const BASE_URL = 'https://api.themoviedb.org/3';

export interface SeProvider { id: number; name: string }

/**
 * Fetch the SE `flatrate` (subscription) providers for a title. Provider name
 * comes straight from the watch/providers response, so the function needs no
 * copy of the client provider catalogue. Returns [] when the title has no SE
 * flatrate offer, null on any failure (caller skips the title — no marker write).
 */
export async function fetchSeFlatrate(tmdbId: number, mediaType: string): Promise<SeProvider[] | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) { logger.error('availableNotify: TMDB_API_KEY not set'); return null; }
  const type = mediaType === 'movie' ? 'movie' : 'tv';
  try {
    const res = await fetch(`${BASE_URL}/${type}/${tmdbId}/watch/providers?api_key=${key}`);
    if (!res.ok) { logger.warn(`availableNotify: TMDB /${type}/${tmdbId}/watch/providers → ${res.status}`); return null; }
    const json = (await res.json()) as {
      results?: { SE?: { flatrate?: { provider_id: number; provider_name: string }[] } };
    };
    const flatrate = json.results?.SE?.flatrate ?? [];
    return flatrate.map((p) => ({ id: p.provider_id, name: p.provider_name }));
  } catch (err) {
    logger.warn(`availableNotify: TMDB fetch failed for ${type}/${tmdbId}`, err);
    return null;
  }
}
