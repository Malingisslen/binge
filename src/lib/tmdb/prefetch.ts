import { getMovie, getTVShow, getTVSeason, type TmdbFetchOpts } from './client';
import { TMDB_STALE } from './cacheTiers';
import type { MediaType, TMDBTVShow, TMDBMovie, TMDBSeasonDetail } from '@/types';

// Prefetch-spec som matchar EXAKT detaljsidornas useQuery (useMovie/useTVShow i
// src/hooks/useTMDB.ts): samma queryKey + staleTime, så en lyckad prefetch gör
// att detaljsidan hittar färdig data i cachen och renderar direkt.
export function titlePrefetchSpec(
  mediaType: MediaType,
  id: number,
): {
  queryKey: readonly [string, number];
  queryFn: (ctx: { signal: AbortSignal }) => Promise<TMDBTVShow | TMDBMovie>;
  staleTime: number;
} {
  if (mediaType === 'tv') {
    return {
      queryKey: ['tv', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getTVShow(id, { signal } satisfies TmdbFetchOpts),
      staleTime: TMDB_STALE.TV_DETAIL,
    };
  }
  return {
    queryKey: ['movie', id],
    queryFn: ({ signal }: { signal: AbortSignal }) => getMovie(id, { signal } satisfies TmdbFetchOpts),
    staleTime: TMDB_STALE.MOVIE_DETAIL,
  };
}

// Aktuell säsong att prefetcha för en TV-detaljsida: next_episode_to_air:s
// säsong om den finns (det är den användaren mest sannolikt öppnar), annars
// sista kända säsongen. Returnerar null om serien saknar säsonger.
export function currentSeasonToPrefetch(show: {
  number_of_seasons?: number | null;
  next_episode_to_air?: { season_number?: number | null } | null;
}): number | null {
  const next = show.next_episode_to_air?.season_number;
  if (typeof next === 'number') return next;
  if (typeof show.number_of_seasons === 'number' && show.number_of_seasons > 0) {
    return show.number_of_seasons;
  }
  return null;
}

export function seasonPrefetchSpec(
  seriesId: number,
  seasonNumber: number,
): {
  queryKey: readonly [string, number, number];
  queryFn: (ctx: { signal: AbortSignal }) => Promise<TMDBSeasonDetail>;
  staleTime: number;
} {
  return {
    queryKey: ['tv-season', seriesId, seasonNumber],
    queryFn: ({ signal }: { signal: AbortSignal }) => getTVSeason(seriesId, seasonNumber, { signal }),
    staleTime: TMDB_STALE.SEASON,
  };
}
