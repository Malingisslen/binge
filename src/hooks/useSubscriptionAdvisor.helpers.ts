// Pure helpers for the subscription advisor.
//
// Extracted from useSubscriptionAdvisor.ts so unit tests can import them
// without pulling in Firebase/React Query/Auth dependencies.

import { formatEpisodeCode, todayIso } from '@/lib/utils';
import type {
  TMDBTVShow,
  ProviderAdvisory,
  ActivePause,
  WatchlistItem,
} from '@/types';

export function findTopPausable(
  providers: ProviderAdvisory[],
  userPausedSet: Set<number>,
): ProviderAdvisory | undefined {
  return providers
    .filter(p => p.status === 'pause' && !userPausedSet.has(p.providerId) && (p.monthlyCost ?? 0) > 0)
    .sort((a, b) => (b.monthlyCost ?? 0) - (a.monthlyCost ?? 0))[0];
}

// Threshold 3 = "påbörjat flera serier" — undviker att tjata om enstaka påbörjade titlar.
export const CATCHUP_THRESHOLD = 3;

export function findCatchupCandidate(
  providers: ProviderAdvisory[],
  followingById: Map<number, WatchlistItem>,
): { provider: ProviderAdvisory; unfinishedCount: number } | undefined {
  return providers
    .filter(p => p.status === 'active')
    .map(p => ({
      provider: p,
      unfinishedCount: p.shows
        .map(s => followingById.get(s.tmdbId))
        .filter((wi): wi is WatchlistItem => !!wi && !!wi.lastWatchedSeason)
        .length,
    }))
    .filter(x => x.unfinishedCount >= CATCHUP_THRESHOLD)
    .sort((a, b) => b.unfinishedCount - a.unfinishedCount)[0];
}

export function findIdleNextCheckDate(
  providers: ProviderAdvisory[],
  activePauses: ActivePause[],
): string | null {
  const candidates: string[] = [];
  for (const p of providers) if (p.nextAirDate) candidates.push(p.nextAirDate);
  for (const ap of activePauses) if (ap.resumeAt) candidates.push(ap.resumeAt);
  candidates.sort();
  return candidates[0] ?? null;
}

export function getNextAirInfo(show: TMDBTVShow): { date: string | null; code: string | null } {
  if (show.next_episode_to_air?.air_date) {
    const ep = show.next_episode_to_air;
    return {
      date: ep.air_date,
      code: formatEpisodeCode(ep.season_number, ep.episode_number),
    };
  }
  const now = todayIso();
  const futureSeason = show.seasons
    ?.filter(s => s.air_date && s.air_date > now && s.season_number > 0)
    .sort((a, b) => a.air_date.localeCompare(b.air_date))[0];
  if (futureSeason?.air_date) {
    return {
      date: futureSeason.air_date,
      code: formatEpisodeCode(futureSeason.season_number, 1),
    };
  }
  return { date: null, code: null };
}

export function isWithinDays(dateStr: string | null, days: number): boolean {
  if (!dateStr) return false;
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + days);
  return target >= now && target <= windowEnd;
}
