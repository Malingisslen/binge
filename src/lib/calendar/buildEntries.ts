import { getProvider } from '@/lib/tmdb/providers';
import { formatEpisodeCode } from '@/lib/utils';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import type { TMDBTVShow, TMDBEpisode } from '@/types';
import type { CalendarEntry } from '@/hooks/useCalendar';

export interface SeasonDatum {
  showId: number;
  show: TMDBTVShow;
  season: { episodes: TMDBEpisode[] } | null;
}

/**
 * Bygger CalendarEntry[] från hämtade säsonger PLUS show.next_episode_to_air.
 * Seedingen från next_episode_to_air är fixen för att kommande avsnitt inte
 * ska tappas när TMDB:s säsong-episodes-array släpar efter show-nivåns
 * next_episode_to_air. Dedupe på `${tmdbId}-S{n}E{n}` så ett seedat avsnitt
 * aldrig dubblerar ett som redan finns i säsong-arrayen.
 */
export function buildCalendarEntries(seasonData: SeasonDatum[]): CalendarEntry[] {
  const result: CalendarEntry[] = [];
  const seen = new Set<string>();
  const key = (id: number, s: number, e: number) => `${id}-S${s}E${e}`;

  for (const item of seasonData) {
    const { show } = item;
    const flatrate = show['watch/providers']?.results?.SE?.flatrate?.[0];
    const providerName = flatrate
      ? (getProvider(flatrate.provider_id)?.shortName ?? flatrate.provider_name)
      : undefined;
    const showGenreIds = show.genres?.map(g => g.id) ?? [];
    const episodes = item.season?.episodes ?? [];
    const finaleEp = episodes.length > 0
      ? Math.max(...episodes.map(e => e.episode_number))
      : 0;

    const push = (ep: TMDBEpisode) => {
      if (!ep.air_date) return;
      const k = key(show.id, ep.season_number, ep.episode_number);
      if (seen.has(k)) return;
      seen.add(k);
      result.push({
        tmdbId: show.id,
        title: preferOriginalTitle(show.name, show.original_name),
        posterPath: show.poster_path,
        backdropPath: ep.still_path ?? show.backdrop_path ?? null,
        season: ep.season_number,
        episode: ep.episode_number,
        episodeCode: formatEpisodeCode(ep.season_number, ep.episode_number),
        episodeName: ep.name,
        episodeOverview: ep.overview ?? undefined,
        airDate: ep.air_date,
        provider: providerName,
        runtime: ep.runtime ?? undefined,
        isPremiere: ep.episode_number === 1,
        isFinale: finaleEp > 0 && ep.episode_number === finaleEp,
        genreIds: showGenreIds,
      });
    };

    for (const ep of episodes) push(ep);
    if (show.next_episode_to_air) push(show.next_episode_to_air);
  }

  return result;
}
