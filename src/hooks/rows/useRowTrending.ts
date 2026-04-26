'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTrending, isAddableMediaType } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters } from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 50;

export function useRowTrending(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const { data, isLoading } = useQuery({
    queryKey: ['rec-trending', 'all', 'week'],
    queryFn: ({ signal }) => getTrending('all', 'week', { signal }),
    staleTime: TMDB_STALE.TRENDING,
  });

  return useMemo(() => {
    const raw = (data?.results ?? []) as RowTitle[];
    const typed = raw
      .filter(isAddableMediaType)
      .map(t => ({ ...t, media_type: (t.media_type ?? 'movie') as 'movie' | 'tv' }));
    const filtered = applyClientFilters(dedupeAndExclude(typed, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [data, excludedIds, filters, rowSpec, isLoading]);
}
