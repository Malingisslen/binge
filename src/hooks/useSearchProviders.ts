'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getWatchProviders } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import type { TMDBSearchResult, TMDBProviderData } from '@/types';

export function useSearchProviders(
  items: (TMDBSearchResult & { media_type: 'movie' | 'tv' })[]
) {
  const queries = useQueries({
    queries: items.map(item => ({
      queryKey: ['watch-providers', item.media_type, item.id],
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        getWatchProviders(item.media_type, item.id, { signal }),
      staleTime: TMDB_STALE.PROVIDERS,
    })),
  });

  return useMemo(() => {
    const map: Record<string, TMDBProviderData> = {};
    items.forEach((item, i) => {
      const data = queries[i]?.data?.results?.SE;
      if (data) {
        map[`${item.media_type}-${item.id}`] = data;
      }
    });
    return map;
  }, [queries, items]);
}
