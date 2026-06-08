import { logger } from 'firebase-functions/v2';
import type { LastEpisode } from './logic';

const BASE_URL = 'https://api.themoviedb.org/3';

export interface TvAiringInfo { status: string | null; lastEpisode: LastEpisode | null; }

/**
 * Fetch only the airing-relevant slice of a TV show: status + last_episode_to_air.
 * Reads the TMDB_API_KEY secret from the process env (bound via defineSecret on
 * the scheduled function). Returns null on any failure — the caller skips the show.
 */
export async function fetchTvAiringInfo(tmdbId: number): Promise<TvAiringInfo | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) { logger.error('episodeNotify: TMDB_API_KEY not set'); return null; }
  try {
    const res = await fetch(`${BASE_URL}/tv/${tmdbId}?api_key=${key}&language=sv-SE`);
    if (!res.ok) { logger.warn(`episodeNotify: TMDB /tv/${tmdbId} → ${res.status}`); return null; }
    const json = (await res.json()) as { status?: string; last_episode_to_air?: { id: number; season_number: number; episode_number: number } | null };
    const last = json.last_episode_to_air ?? null;
    return { status: json.status ?? null, lastEpisode: last ? { id: last.id, season_number: last.season_number, episode_number: last.episode_number } : null };
  } catch (err) { logger.warn(`episodeNotify: TMDB fetch failed for ${tmdbId}`, err); return null; }
}
