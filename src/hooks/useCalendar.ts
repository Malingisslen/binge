'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { getTVShow } from '@/lib/tmdb/client';
import { getProvider } from '@/lib/tmdb/providers';

export interface CalendarEntry {
  tmdbId: number;
  title: string;
  episodeCode: string;
  airDate: string;
  provider?: string;
}

export function useCalendarEntries() {
  const { getByStatus } = useWatchlist();
  const watchingTV = getByStatus('watching', 'tv');
  const tmdbIds = watchingTV.map(i => i.tmdbId);

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

  const entries: CalendarEntry[] = useMemo(() => {
    if (!shows) return [];
    const result: CalendarEntry[] = [];

    for (const show of shows) {
      if (!show) continue;
      const nextEp = show.next_episode_to_air;
      if (nextEp?.air_date) {
        const providers = show['watch/providers']?.results?.SE;
        const flatrate = providers?.flatrate?.[0];
        const providerName = flatrate ? (getProvider(flatrate.provider_id)?.shortName ?? flatrate.provider_name) : undefined;

        result.push({
          tmdbId: show.id,
          title: show.name,
          episodeCode: `S${nextEp.season_number}E${nextEp.episode_number}`,
          airDate: nextEp.air_date,
          provider: providerName,
        });
      }
    }
    return result;
  }, [shows]);

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
