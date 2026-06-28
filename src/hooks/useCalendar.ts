'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { getTVShowLite, getTVSeason, getMovieLite } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { buildCalendarEntries, buildMovieEntries } from '@/lib/calendar/buildEntries';
import type { TMDBTVShow, TMDBMovie } from '@/types';

// CalendarEntry-modellen bor i @/lib/calendar/types (diskriminerad union över
// avsnitt + filmsläpp). Re-exporteras här eftersom alla konsumenter historiskt
// importerar `CalendarEntry` från '@/hooks/useCalendar'.
export type {
  CalendarEntry,
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

export function useCalendarEntries(opts: { enabled?: boolean } = {}): UseCalendarResult {
  const enabled = opts.enabled ?? true;
  const { getByStatus } = useWatchlist();
  // Kalendern visar avsnitt för alla serier du följer ('mina') — inklusive
  // ej påbörjade (premiärbevakning är ett kärnvärde). Filmer i 'vill_se'
  // bidrar med digitala släppdatum längre ner.
  // useMemo so the .filter() traversal runs only when items change (getByStatus is
  // useCallback([items])), not on every render of a parent owning this hook (BIN-336).
  const minaTV = useMemo(() => getByStatus('mina', 'tv'), [getByStatus]);
  const tmdbIds = useMemo(
    () => minaTV.map(i => i.tmdbId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minaTV.map(i => i.tmdbId).join(',')]
  );

  const showQueries = useQueries({
    queries: tmdbIds.map(id => ({
      queryKey: ['tv-lite', id],
      // Delad lite-nyckel + signal: ['tv-lite', id] läses även av
      // useSubscriptionAdvisor — båda är fan-out-ytor som bara behöver
      // basfält + watch/providers, inte fulla detaljsvaret. Samma
      // staleTime-konstant (LITE_DETAIL) så observers inte slåss om cachen
      // (H3). Signal avbryter in-flight fetches vid navigation bort så
      // semaphore-slots inte läcker.
      queryFn: ({ signal }: { signal: AbortSignal }) => getTVShowLite(id, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
      enabled,
    })),
  });

  const shows = useMemo(
    () => showQueries.map(q => q.data).filter((d): d is TMDBTVShow => d != null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showQueries.map(q => q.dataUpdatedAt).join(',')]
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
    return shows.map(show => ({
      showId: show.id,
      seasonNum: show.next_episode_to_air?.season_number ?? show.number_of_seasons,
      show,
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
      enabled,
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
  // Egen lite-nyckel ['movie-lite', id]: titelsidans fulla svar (['movie', id]
  // via useMovie) är 5-10× större och ska inte fan-out:as här. getMovieLite
  // hämtar release_dates + watch/providers via append_to_response — allt
  // kalendern behöver.
  const villSeMovies = useMemo(() => getByStatus('vill_se', 'movie'), [getByStatus]);
  const movieIds = useMemo(
    () => villSeMovies.map(i => i.tmdbId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [villSeMovies.map(i => i.tmdbId).join(',')]
  );

  const movieQueries = useQueries({
    queries: movieIds.map(id => ({
      queryKey: ['movie-lite', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getMovieLite(id, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
      enabled,
    })),
  });

  const movies = useMemo(
    () => movieQueries.map(q => q.data).filter((d): d is TMDBMovie => d != null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [movieQueries.map(q => q.dataUpdatedAt).join(',')]
  );

  const moviesPending = movieIds.length > 0 && movieQueries.some(q => q.isPending);

  const entries: CalendarEntry[] = useMemo(() => {
    return [
      ...buildCalendarEntries(seasonData),
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
