'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getMovieLite, getTVShowLite, getWatchProviders } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { refineTitles, titleKey, type RowRefinement } from '@/lib/recommendations/refineTitles';
import type { RowTitle, TMDBMovie, TMDBProviderData, TMDBTVShow } from '@/types';

const NONE: RowTitle[] = [];

/** Minutes for a film; one episode for a series. */
function runtimeOf(data: TMDBMovie | TMDBTVShow | undefined, mediaType: 'movie' | 'tv'): number | null {
  if (!data) return null;
  if (mediaType === 'movie') return (data as TMDBMovie).runtime || null;
  const tv = data as TMDBTVShow;
  return tv.episode_run_time?.[0] || tv.last_episode_to_air?.runtime || null;
}

/**
 * Applies a row's service, length and sort choices. Provider and runtime data are
 * fetched only while their filter is on, through the cache keys the rest of the app
 * shares. `pending` is true while any needed fact is still loading, so a row is not
 * called empty before it knows.
 */
export function useRefinedTitles(items: RowTitle[], r: RowRefinement): { items: RowTitle[]; pending: boolean } {
  const providerItems = r.providerIds ? items : NONE;
  const runtimeItems = r.length ? items : NONE;

  const providerQueries = useQueries({
    queries: providerItems.map(item => ({
      queryKey: ['watch-providers', item.media_type, item.id],
      queryFn: ({ signal }: { signal?: AbortSignal }) => getWatchProviders(item.media_type, item.id, { signal }),
      staleTime: TMDB_STALE.PROVIDERS,
    })),
  });
  const runtimeQueries = useQueries({
    queries: runtimeItems.map(item => ({
      queryKey: [item.media_type === 'movie' ? 'movie-lite' : 'tv-lite', item.id],
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        item.media_type === 'movie' ? getMovieLite(item.id, { signal }) : getTVShowLite(item.id, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
    })),
  });

  const pending = providerQueries.some(q => q.isLoading) || runtimeQueries.some(q => q.isLoading);
  // useQueries hands back new arrays every render; key the result on what changed.
  const dataSig = [...providerQueries, ...runtimeQueries].map(q => q.dataUpdatedAt).join(',');

  const refined = useMemo(() => {
    const providersByKey: Record<string, TMDBProviderData | undefined> = {};
    providerItems.forEach((item, i) => {
      const se = providerQueries[i]?.data?.results?.SE;
      if (se) providersByKey[titleKey(item)] = se;
    });
    const runtimeByKey: Record<string, number | null> = {};
    runtimeItems.forEach((item, i) => {
      runtimeByKey[titleKey(item)] = runtimeOf(runtimeQueries[i]?.data as TMDBMovie | TMDBTVShow | undefined, item.media_type);
    });
    return refineTitles(items, { providersByKey, runtimeByKey }, r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, r, providerItems, runtimeItems, dataSig]);

  return { items: refined, pending };
}
