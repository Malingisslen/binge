/**
 * Pure qualification + dedupe logic for episode-release push.
 *
 * Faithful copies of the client's airing/sub-state logic so server and client
 * agree on which shows count as 'ikapp':
 *   - airingState / isEndedStatus  ← src/lib/airingState.ts
 *   - isUserBehindOnAired          ← src/hooks/useSubscriptionAdvisor.helpers.ts
 *   - the 'ikapp' branch of        ← src/lib/watchStatus.ts (tvSubState)
 *
 * No firebase-admin import — runs under the root Vitest suite. The client logic
 * uses @/ aliases that don't resolve under functions/tsconfig.json, so the pure
 * functions are copied verbatim rather than imported.
 */

export type AiringState = 'ongoing' | 'ended' | 'unknown';
export type TvSubState = 'aktiv' | 'ikapp' | 'avslutad' | 'none';
export interface LastEpisode { id: number; season_number: number; episode_number: number; }
export interface WatchlistLite {
  uid: string; tmdbId: number; mediaType: string; status: string; title: string;
  lastWatchedSeason: number | null; lastWatchedEpisode: number | null; tmdbStatus: string | null;
}

export function airingState(tmdbStatus: string | null | undefined): AiringState {
  if (!tmdbStatus) return 'unknown';
  const s = tmdbStatus.toLowerCase();
  if (s === 'returning series' || s === 'in production' || s === 'planned') return 'ongoing';
  if (s === 'ended' || s === 'canceled' || s === 'cancelled' || s === 'pilot') return 'ended';
  return 'unknown';
}
export function isEndedStatus(tmdbStatus: string | null | undefined): boolean {
  return airingState(tmdbStatus) === 'ended';
}
export function isUserBehindOnAired(item: WatchlistLite, last: LastEpisode | null): boolean {
  if (item.lastWatchedSeason == null) return false;
  if (!last) return false;
  const userS = item.lastWatchedSeason ?? 0;
  const userE = item.lastWatchedEpisode ?? 0;
  if (userS < last.season_number) return true;
  if (userS === last.season_number && userE < last.episode_number) return true;
  return false;
}
export function deriveSubState(item: WatchlistLite, tmdbStatus: string | null, last: LastEpisode | null): TvSubState {
  if (item.mediaType !== 'tv') return 'none';
  if (item.status !== 'mina') return 'none';
  if (item.lastWatchedSeason == null) return 'none';
  if (isUserBehindOnAired(item, last)) return 'aktiv';
  return isEndedStatus(tmdbStatus) ? 'avslutad' : 'ikapp';
}
export function shouldNotify(last: LastEpisode | null, lastNotifiedEpisodeId: number | null): boolean {
  if (!last) return false;
  return last.id !== lastNotifiedEpisodeId;
}
