'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getTrending, isAddableMediaType } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters } from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 100;

export function useRowTrending(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const queries = useQueries({
    queries: [
      { queryKey: ['rec-trending', 'all', 'week', 1], queryFn: ({ signal }: { signal?: AbortSignal }) => getTrending('all', 'week', { signal, page: 1 }), staleTime: TMDB_STALE.TRENDING },
      { queryKey: ['rec-trending', 'all', 'week', 2], queryFn: ({ signal }: { signal?: AbortSignal }) => getTrending('all', 'week', { signal, page: 2 }), staleTime: TMDB_STALE.TRENDING },
    ],
  });
  const dataP1 = queries[0]?.data?.results;
  const dataP2 = queries[1]?.data?.results;
  const isLoading = queries.some(q => q.isLoading);

  return useMemo(() => {
    const raw = [...(dataP1 ?? []), ...(dataP2 ?? [])] as RowTitle[];
    const typed = raw
      .filter(isAddableMediaType)
      .map(t => ({ ...t, media_type: (t.media_type ?? 'movie') as 'movie' | 'tv' }));
    const filtered = applyClientFilters(dedupeAndExclude(typed, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [dataP1, dataP2, excludedIds, filters, rowSpec, isLoading]);
}
