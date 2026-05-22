'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { getTVShow, getTVSeason } from '@/lib/tmdb/client';
import { getProvider } from '@/lib/tmdb/providers';
import { formatEpisodeCode } from '@/lib/utils';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import type { TMDBTVShow } from '@/types';

export interface CalendarEntry {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  season: number;
  episode: number;
  episodeCode: string;
  episodeName?: string;
  episodeOverview?: string;
  airDate: string;
  provider?: string;
  runtime?: number;
  isPremiere?: boolean;
  isFinale?: boolean;
  genreIds?: number[];
}

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
  const followingTV = getByStatus('mina', 'tv');
  const tmdbIds = useMemo(() => followingTV.map(i => i.tmdbId), [followingTV]);

  const showQueries = useQueries({
    queries: tmdbIds.map(id => ({
      queryKey: ['tv', id],
      queryFn: () => getTVShow(id),
      staleTime: 10 * 60 * 1000,
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
      seasonNum: show.number_of_seasons,
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
      staleTime: 30 * 60 * 1000,
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

  const entries: CalendarEntry[] = useMemo(() => {
    if (seasonData.length === 0) return [];
    const result: CalendarEntry[] = [];

    for (const item of seasonData) {
      if (!item.season?.episodes) continue;

      const providers = item.show['watch/providers']?.results?.SE;
      const flatrate = providers?.flatrate?.[0];
      const providerName = flatrate
        ? (getProvider(flatrate.provider_id)?.shortName ?? flatrate.provider_name)
        : undefined;

      // Pre-compute finale episode number for the current season so each
      // CalendarEntry can carry `isFinale` without re-deriving downstream.
      const finaleEp = item.season.episodes.length > 0
        ? Math.max(...item.season.episodes.map(e => e.episode_number))
        : 0;
      const showGenreIds = item.show.genres?.map(g => g.id) ?? [];

      for (const ep of item.season.episodes) {
        if (!ep.air_date) continue;
        result.push({
          tmdbId: item.showId,
          title: preferOriginalTitle(item.show.name, item.show.original_name),
          posterPath: item.show.poster_path,
          backdropPath: ep.still_path ?? item.show.backdrop_path ?? null,
          season: ep.season_number,
          episode: ep.episode_number,
          episodeCode: formatEpisodeCode(ep.season_number, ep.episode_number),
          episodeName: ep.name,
          episodeOverview: ep.overview ?? undefined,
          airDate: ep.air_date,
          provider: providerName,
          runtime: ep.runtime ?? undefined,
          // S1E1 = series premiere when the show only has one season,
          // otherwise "ny säsong"-flag. We collapse both into `isPremiere`
          // so the badge in the calendar week board says "premiär" for either.
          isPremiere: ep.episode_number === 1,
          isFinale: finaleEp > 0 && ep.episode_number === finaleEp,
          genreIds: showGenreIds,
        });
      }
    }

    return result;
  }, [seasonData]);

  // Kalendern är "loading" om något steg i vattenfallet fortfarande väntar:
  // (1) shows-queries har inte registrerats än, (2) någon show-detail är
  // pending, eller (3) någon säsong är pending. Med per-säsong queries
  // räcker `isPending`-kollen — det finns inget "disabled" fall längre.
  const isLoading =
    tmdbIds.length > 0 && (showsNotStartedYet || showsPending || seasonsPending);

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
