import { logger } from 'firebase-functions/v2';
import type { LastEpisode } from '../episodeNotify/logic';
import type { NextEpisode } from './logic';

const BASE_URL = 'https://api.themoviedb.org/3';

export interface TvReturnInfo {
  status: string | null;
  lastEpisode: LastEpisode | null;
  nextEpisode: NextEpisode | null;
}

/**
 * Fetch the airing slice needed to detect a dormancy return: status +
 * last_episode_to_air (for caught-up derivation) + next_episode_to_air (the
 * announced return). Reads TMDB_API_KEY from process env (bound via defineSecret
 * on the scheduled function). Returns null on any failure — caller skips the show.
 */
export async function fetchTvReturnInfo(tmdbId: number): Promise<TvReturnInfo | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) { logger.error('returnNotify: TMDB_API_KEY not set'); return null; }
  try {
    // BIN-293: 10s ceiling so one hung TMDB call can't block the per-title
    // fan-out loop to the function's hard timeout; the catch degrades to null.
    const res = await fetch(`${BASE_URL}/tv/${tmdbId}?api_key=${key}&language=sv-SE`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) { logger.warn(`returnNotify: TMDB /tv/${tmdbId} → ${res.status}`); return null; }
    const json = (await res.json()) as {
      status?: string;
      last_episode_to_air?: { id: number; season_number: number; episode_number: number } | null;
      next_episode_to_air?: { id: number; season_number: number; episode_number: number; air_date?: string | null } | null;
    };
    const last = json.last_episode_to_air ?? null;
    const nxt = json.next_episode_to_air ?? null;
    return {
      status: json.status ?? null,
      lastEpisode: last ? { id: last.id, season_number: last.season_number, episode_number: last.episode_number } : null,
      nextEpisode: nxt ? { id: nxt.id, season_number: nxt.season_number, episode_number: nxt.episode_number, air_date: nxt.air_date ?? null } : null,
    };
  } catch (err) { logger.warn(`returnNotify: TMDB fetch failed for ${tmdbId}`, err); return null; }
}
