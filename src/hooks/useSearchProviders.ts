'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getWatchProviders } from '@/lib/tmdb/client';
import type { TMDBSearchResult, TMDBProviderData } from '@/types';

export function useSearchProviders(
  items: (TMDBSearchResult & { media_type: 'movie' | 'tv' })[]
) {
  const queries = useQueries({
    queries: items.map(item => ({
      queryKey: ['watch-providers', item.media_type, item.id],
      queryFn: () => getWatchProviders(item.media_type, item.id),
      staleTime: 30 * 60 * 1000,
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
