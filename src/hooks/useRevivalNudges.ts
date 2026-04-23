'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { getTVShow } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { isOngoing } from '@/lib/airingState';
import type { TMDBTVShow, WatchlistItem } from '@/types';

export interface RevivalNudge {
  item: WatchlistItem;
  show: TMDBTVShow;
  nextAirDate: string;
}

// Cap the fetch set: only watched TV shows whose tmdbStatus we've already
// cached (i.e. user visited the detail page). Narrows the dashboard fan-out
// so large libraries don't trigger a wide TMDB refetch on every render.
const MAX_CHECKS = 20;

export function useRevivalNudges(): { nudges: RevivalNudge[]; isLoading: boolean } {
  const { getByStatus } = useWatchlist();

  const candidates = useMemo(() => {
    const watchedTv = getByStatus('sedd', 'tv').filter(i => !i.dropped && i.tmdbStatus != null);
    // Sort by most-recently-watched first so we prioritize recent titles.
    return [...watchedTv]
      .sort((a, b) => (b.watchedAt?.getTime() ?? 0) - (a.watchedAt?.getTime() ?? 0))
      .slice(0, MAX_CHECKS);
  }, [getByStatus]);

  const queries = useQueries({
    queries: candidates.map(item => ({
      queryKey: ['tv', item.tmdbId],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getTVShow(item.tmdbId, { signal }),
      // Delad staleTime med useTVShow + useSubscriptionAdvisor så att inga
      // två observers slåss om samma ['tv', id]-nyckel.
      staleTime: TMDB_STALE.TV_DETAIL,
    })),
  });

  const isLoading = queries.some(q => q.isLoading);

  const nudges = useMemo(() => {
    const out: RevivalNudge[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const show = queries[i]?.data;
      if (!show) continue;
      const item = candidates[i];
      const nextAir = show.next_episode_to_air?.air_date ?? null;
      const hasUpcomingEpisode = !!nextAir;
      const cameBackToLife = isOngoing(show.status) && !isOngoing(item.tmdbStatus);
      if (hasUpcomingEpisode && cameBackToLife) {
        out.push({ item, show, nextAirDate: nextAir! });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, queries.map(q => q.dataUpdatedAt).join(',')]);

  return { nudges, isLoading };
}
