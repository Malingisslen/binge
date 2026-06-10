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

// A1/X1: "allt laddat?"-aggregering för rådgivaren. Rådgivaren är klar först
// när (a) watchlist-snapshoten från Firestore landat OCH (b) varje registrerad
// TMDB-detaljquery avgjorts (data eller fel). Utan watchlist-gaten rapporterar
// useQueries([]) "klar" innan items ens hunnit registrera sina queries, och
// sidan renderar definitiv rådgivning på noll data som sedan flippar medan
// queries strömmar in. Per query gäller isLoading-semantiken (isPending &&
// isFetching): cached data blockerar inte (stale-while-revalidate), och
// error-queries räknas som avgjorda så hasError-flödet kan ta över.
export function aggregateAdvisorLoading(
  watchlistLoading: boolean,
  queries: ReadonlyArray<{ isPending: boolean; isFetching: boolean }>,
): boolean {
  if (watchlistLoading) return true;
  return queries.some(q => q.isPending && q.isFetching);
}

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

// "Behind" = användaren har börjat titta MEN det finns aireade avsnitt
// hen inte sett. Ej börjat → inte behind. Ikapp på allt aireat → inte behind
// (även om showen är "Returning Series" och nya avsnitt är på väg).
// Användaren ser tillbaka-felet i Streamingrådgivaren när vi räknar
// "påbörjade" som "behind", så denna funktion är källan till sanning.
export function isUserBehindOnAired(item: WatchlistItem, show: TMDBTVShow): boolean {
  // == null (inte falsy): säsong 0 (Specials) är giltig progress och får inte
  // kollapsas ihop med "ej börjat" (L3).
  if (item.lastWatchedSeason == null) return false;
  const last = show.last_episode_to_air;
  if (!last) return false;
  const userS = item.lastWatchedSeason ?? 0;
  const userE = item.lastWatchedEpisode ?? 0;
  if (userS < last.season_number) return true;
  if (userS === last.season_number && userE < last.episode_number) return true;
  return false;
}

export function findCatchupCandidate(
  providers: ProviderAdvisory[],
  unfinishedIds: Set<number>,
): { provider: ProviderAdvisory; unfinishedCount: number } | undefined {
  return providers
    .filter(p => p.status === 'active')
    .map(p => ({
      provider: p,
      unfinishedCount: p.shows.filter(s => unfinishedIds.has(s.tmdbId)).length,
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
