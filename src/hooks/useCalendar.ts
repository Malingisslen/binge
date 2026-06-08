'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { getTVShow, getTVSeason, getMovie } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { buildCalendarEntries, buildMovieEntries } from '@/lib/calendar/buildEntries';
import type { TMDBTVShow, TMDBMovie } from '@/types';

// CalendarEntry-modellen bor i @/lib/calendar/types (diskriminerad union över
// avsnitt + filmsläpp). Re-exporteras här eftersom alla konsumenter historiskt
// importerar `CalendarEntry` från '@/hooks/useCalendar'.
export type {
  CalendarEntry,
  CalendarSource,
  EpisodeEntry,
  MovieEntry,
} from '@/lib/calendar/types';
import type { CalendarEntry } from '@/lib/calendar/types';

export interface UseCalendarResult {
  entries: CalendarEntry[];
  /**
   * True så länge någon del av kalender-vattenfallet (tv-show eller season)
   * fortfarande väntar på TMDB. Skiljer "tom kalender" från "kalendern laddar"
   * så konsumenter inte renderar tom-state innan datat har landat.
   */
  isLoading: boolean;
}

export function useCalendarEntries(): UseCalendarResult {
  const { getByStatus } = useWatchlist();
  // Kalendern visar avsnitt för serier du tittar på ('mina') OCH serier du vill
  // se ('vill_se') — samma show/säsong-pipeline, men källan stämplas så UI:n
  // kan skilja dem åt (vill_se får ingen "markera sedd"-toggel). Vi behåller
  // source-ordningen [...mina, ...vill_se] stabil så query-index inte hoppar.
  const minaTV = getByStatus('mina', 'tv');
  const villSeTV = getByStatus('vill_se', 'tv');
  const tvSpecs = useMemo(
    () => [
      ...minaTV.map(i => ({ id: i.tmdbId, source: 'mina' as const })),
      ...villSeTV.map(i => ({ id: i.tmdbId, source: 'vill_se' as const })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minaTV.map(i => i.tmdbId).join(','), villSeTV.map(i => i.tmdbId).join(',')]
  );
  const tmdbIds = useMemo(() => tvSpecs.map(s => s.id), [tvSpecs]);

  const showQueries = useQueries({
    queries: tvSpecs.map(spec => ({
      queryKey: ['tv', spec.id],
      // Delad staleTime-konstant + signal: ['tv', id] läses även av useTVShow,
      // useSubscriptionAdvisor och useRevivalNudges. Olika staleTime skulle få
      // observers att slåss om cachen (H3). Signal avbryter in-flight fetches
      // vid navigation bort så semaphore-slots inte läcker.
      queryFn: ({ signal }: { signal: AbortSignal }) => getTVShow(spec.id, { signal }),
      staleTime: TMDB_STALE.TV_DETAIL,
    })),
  });

  // Behåll source-taggen ihop med datat så entries kan byggas per källa.
  const shows = useMemo(
    () =>
      showQueries
        .map((q, i) => ({ show: q.data, source: tvSpecs[i]?.source ?? 'mina' }))
        .filter((x): x is { show: TMDBTVShow; source: 'mina' | 'vill_se' } => x.show != null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showQueries.map(q => q.dataUpdatedAt).join(','), tvSpecs]
  );

  // Loading-detektion baserad på data-närvaro snarare än react-querys
  // isLoading-flagga: en query räknas som "klar" så snart status inte är
  // 'pending' (success ELLER error — vi vill inte fastna i loading om en
  // TMDB-fetch misslyckats). Kolla också att vi har minst en show innan
  // vi förklarar oss klara — annars stannar vi i "tom"-state innan
  // queries hunnit registreras.
  const showsPending = tmdbIds.length > 0 && showQueries.some(q => q.isPending);
  const showsNotStartedYet = tmdbIds.length > 0 && showQueries.length === 0;

  const seasonSpecs = useMemo(() => {
    return shows.map(({ show, source }) => ({
      showId: show.id,
      seasonNum: show.next_episode_to_air?.season_number ?? show.number_of_seasons,
      show,
      source,
    }));
  }, [shows]);

  // KRITISKT: individuella useQueries per (show, season) istället för en
  // batchad query med joined queryKey. Den gamla varianten hade en queryKey
  // som inkluderade *hela* shows-listan — varje gång en ny show resolverade
  // växte listan, queryKey:n bytte, react-query betraktade det som en ny
  // query och re-fetchade ALLA säsonger. Med N shows blev det
  // 1+2+...+N = O(N²/2) requests (t.ex. 7260 fetches för 120 shows istället
  // för 120). Per-show useQueries cacheas individuellt → exakt N requests,
  // återanvänds även mellan sessioner via staleTime.
  const seasonQueries = useQueries({
    queries: seasonSpecs.map(spec => ({
      queryKey: ['tv-season', spec.showId, spec.seasonNum] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getTVSeason(spec.showId, spec.seasonNum, { signal }),
      staleTime: TMDB_STALE.SEASON,
    })),
  });

  // Slå ihop spec + season-data per index. Filtrera bort failade fetches
  // genom att behålla undefined-season men hoppa över i entries-byggare.
  const seasonData = useMemo(
    () =>
      seasonSpecs.map((spec, i) => ({
        ...spec,
        season: seasonQueries[i]?.data ?? null,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seasonSpecs, seasonQueries.map(q => q.dataUpdatedAt).join(',')]
  );

  const seasonsPending =
    seasonSpecs.length > 0 && seasonQueries.some(q => q.isPending);

  // --- Filmsläpp: filmer i 'vill_se' med svenskt digitalt releasedatum ---
  // Delar queryKey ['movie', id] + staleTime med useMovie (detaljsidan) så
  // cachen återanvänds. getMovie hämtar release_dates via append_to_response.
  const villSeMovies = getByStatus('vill_se', 'movie');
  const movieIds = useMemo(
    () => villSeMovies.map(i => i.tmdbId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [villSeMovies.map(i => i.tmdbId).join(',')]
  );

  const movieQueries = useQueries({
    queries: movieIds.map(id => ({
      queryKey: ['movie', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getMovie(id, { signal }),
      staleTime: TMDB_STALE.MOVIE_DETAIL,
    })),
  });

  const movies = useMemo(
    () => movieQueries.map(q => q.data).filter((d): d is TMDBMovie => d != null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [movieQueries.map(q => q.dataUpdatedAt).join(',')]
  );

  const moviesPending = movieIds.length > 0 && movieQueries.some(q => q.isPending);

  const entries: CalendarEntry[] = useMemo(() => {
    // Bygg avsnitts-entries per källa så source-taggen blir rätt, slå sedan
    // ihop med filmsläppen.
    const minaData = seasonData.filter(d => d.source === 'mina');
    const villSeData = seasonData.filter(d => d.source === 'vill_se');
    return [
      ...buildCalendarEntries(minaData, 'mina'),
      ...buildCalendarEntries(villSeData, 'vill_se'),
      ...buildMovieEntries(movies),
    ];
  }, [seasonData, movies]);

  // Kalendern är "loading" om något steg i vattenfallet fortfarande väntar:
  // (1) shows-queries har inte registrerats än, (2) någon show-detail är
  // pending, (3) någon säsong är pending, eller (4) någon film-detalj är
  // pending. Med per-säsong/per-film queries räcker `isPending`-kollen.
  const isLoading =
    (tmdbIds.length > 0 && (showsNotStartedYet || showsPending || seasonsPending)) ||
    moviesPending;

  return { entries, isLoading };
}

export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatWeekday(date: Date): string {
  return date.toLocaleDateString('sv-SE', { weekday: 'short' }).slice(0, 3);
}

export function getMonthDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const startDay = first.getDay() || 7; // Monday=1
  const start = new Date(first);
  start.setDate(start.getDate() - (startDay - 1));
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
