'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getTVShowLite } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { isUserBehindOnAired } from '@/hooks/useSubscriptionAdvisor.helpers';
import type { TMDBTVShow, WatchlistItem } from '@/types';

/**
 * The followed series where an aired episode is still unseen, from the same
 * ['tv-lite', id] cache the calendar and the advisor already fill. Unlike the advisor it does
 * not depend on the user having picked streaming services.
 */
export function useBehindShows(followed: readonly WatchlistItem[]): { behindIds: Set<number>; isLoading: boolean } {
  const started = useMemo(() => followed.filter(i => i.lastWatchedSeason != null), [followed]);
  const queries = useQueries({
    queries: started.map(i => ({
      queryKey: ['tv-lite', i.tmdbId],
      queryFn: ({ signal }: { signal: AbortSignal }) => getTVShowLite(i.tmdbId, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
    })),
  });
  const isLoading = queries.some(q => q.isLoading);
  const stamp = queries.map(q => q.dataUpdatedAt).join(',');
  const behindIds = useMemo(() => {
    const shows = new Map<number, TMDBTVShow>();
    for (const q of queries) if (q.data) shows.set(q.data.id, q.data);
    const out = new Set<number>();
    for (const item of started) {
      const show = shows.get(item.tmdbId);
      if (show && isUserBehindOnAired(item, show)) out.add(item.tmdbId);
    }
    return out;
    // queries is a new array each render; dataUpdatedAt marks when any answer changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, stamp]);
  return { behindIds, isLoading };
}
