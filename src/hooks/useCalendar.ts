'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { getTVShow, getTVSeason } from '@/lib/tmdb/client';
import { getProvider } from '@/lib/tmdb/providers';

export interface CalendarEntry {
  tmdbId: number;
  title: string;
  episodeCode: string;
  episodeName?: string;
  airDate: string;
  provider?: string;
}

export function useCalendarEntries() {
  const { getByStatus } = useWatchlist();
  const followingTV = getByStatus('följer', 'tv');
  // Only show calendar for shows the user has actually started watching
  const activeTV = followingTV.filter(i => i.lastWatchedSeason !== null || i.lastWatchedEpisode !== null);
  const tmdbIds = activeTV.map(i => i.tmdbId);

  // Fetch show details to get season info and providers
  const { data: shows } = useQuery({
    queryKey: ['calendar-shows', [...tmdbIds].sort().join(',')],
    queryFn: async () => {
      if (tmdbIds.length === 0) return [];
      const results = await Promise.all(
        tmdbIds.map(id => getTVShow(id).catch(() => null))
      );
      return results.filter(Boolean);
    },
    enabled: tmdbIds.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  // For each show, fetch the latest/current season's episodes
  const seasonQueries = useMemo(() => {
    if (!shows) return [];
    return shows
      .filter(s => s !== null)
      .map(show => {
        const latestSeason = show!.number_of_seasons;
        return { showId: show!.id, seasonNum: latestSeason, show: show! };
      });
  }, [shows]);

  const { data: seasonData } = useQuery({
    queryKey: ['calendar-seasons', seasonQueries.map(q => `${q.showId}-${q.seasonNum}`).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        seasonQueries.map(async q => {
          try {
            const season = await getTVSeason(q.showId, q.seasonNum);
            return { ...q, season };
          } catch {
            return { ...q, season: null };
          }
        })
      );
      return results;
    },
    enabled: seasonQueries.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  const entries: CalendarEntry[] = useMemo(() => {
    if (!seasonData) return [];
    const result: CalendarEntry[] = [];

    for (const item of seasonData) {
      if (!item.season?.episodes) continue;

      const providers = item.show['watch/providers']?.results?.SE;
      const flatrate = providers?.flatrate?.[0];
      const providerName = flatrate
        ? (getProvider(flatrate.provider_id)?.shortName ?? flatrate.provider_name)
        : undefined;

      for (const ep of item.season.episodes) {
        if (!ep.air_date) continue;
        result.push({
          tmdbId: item.showId,
          title: item.show.name,
          episodeCode: `S${ep.season_number}E${ep.episode_number}`,
          episodeName: ep.name,
          airDate: ep.air_date,
          provider: providerName,
        });
      }
    }

    return result;
  }, [seasonData]);

  return entries;
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

export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
