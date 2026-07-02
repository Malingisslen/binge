import { getProvider } from '@/lib/tmdb/providers';
import { formatEpisodeCode, todayIso } from '@/lib/utils';
import type { TMDBTVShow, TMDBProviderData } from '@/types';

// Kanoniskt hem för "när sänds nästa avsnitt?"-härledningen (instant week,
// 2026-07). Hoistad från useSubscriptionAdvisor.helpers (den kompletta
// varianten med seasons-fallback) så rådgivaren, kalendern och
// nextAirReadRepair delar EN implementation — aldrig en tredje kopia.

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

/**
 * Provider-policy för kalenderns metarader (H3): visa var titeln STREAMAS när
 * TMDB vet det — flatrate, free eller ads (i den ordningen). Rent/buy räknas
 * inte ("kan köpas" är inte "sänds på"). Saknar TMDB SE-data helt lämnas
 * provider tom; konsumenterna visar då bara dag · avsnittskod — det är
 * datagränsen, inte en bugg. (Flyttad hit från buildEntries — delas med
 * nextAirReadRepair.)
 */
export function streamingProviderName(data: TMDBProviderData | undefined): string | undefined {
  const p = data?.flatrate?.[0] ?? data?.free?.[0] ?? data?.ads?.[0];
  return p ? (getProvider(p.provider_id)?.shortName ?? p.provider_name) : undefined;
}
