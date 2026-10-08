'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getMovieLite, getTVShowLite } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import type { TMDBMovie, TMDBTVShow, WatchlistItem } from '@/types';

const NONE: WatchlistItem[] = [];

/**
 * Runtime per library title (minutes for a film, one episode for a series), keyed by
 * mediaTypeDocId. The stored runtime is used where it exists; only titles saved without
 * one are looked up, only while `enabled`, through the shared lite cache keys.
 */
export function useLibraryRuntimes(items: WatchlistItem[], enabled: boolean): {
  runtimeOf: (item: WatchlistItem) => number | null;
  pending: boolean;
} {
  const missing = useMemo(() => (enabled ? items.filter(i => !i.runtime) : NONE), [items, enabled]);
  const queries = useQueries({
    queries: missing.map(item => ({
      queryKey: [item.mediaType === 'movie' ? 'movie-lite' : 'tv-lite', item.tmdbId],
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        item.mediaType === 'movie' ? getMovieLite(item.tmdbId, { signal }) : getTVShowLite(item.tmdbId, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
    })),
  });
  const pending = queries.some(q => q.isLoading);
  // useQueries hands back a new array every render; key the derived map on what
  // actually changed so the list below keeps its identity (and its scroll window).
  const dataSig = queries.map(q => q.dataUpdatedAt).join(',');

  const fetched = useMemo(() => {
    const m = new Map<string, number | null>();
    missing.forEach((item, i) => {
      const data = queries[i]?.data as TMDBMovie | TMDBTVShow | undefined;
      if (!data) return;
      const minutes = item.mediaType === 'movie'
        ? (data as TMDBMovie).runtime
        : (data as TMDBTVShow).episode_run_time?.[0] || (data as TMDBTVShow).last_episode_to_air?.runtime;
      m.set(mediaTypeDocId(item.mediaType, item.tmdbId), minutes || null);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing, dataSig]);

  const runtimeOf = useMemo(
    () => (item: WatchlistItem) => item.runtime || fetched.get(mediaTypeDocId(item.mediaType, item.tmdbId)) || null,
    [fetched],
  );
  return { runtimeOf, pending };
}
