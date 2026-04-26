'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { discoverMovies } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters } from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 50;

export function useRowUpcoming(
  rowSpec: RowSpec,
  myProviders: readonly number[],
  topGenreIds: readonly number[],
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const today = new Date().toISOString().slice(0, 10);
  const enabled = myProviders.length > 0;

  const params: Record<string, string> = {
    'primary_release_date.gte': today,
    with_watch_providers: myProviders.join('|'),
    watch_region: 'SE',
    sort_by: 'primary_release_date.asc',
    ...(topGenreIds.length ? { with_genres: topGenreIds.join('|') } : {}),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['rec-upcoming', myProviders.join(','), topGenreIds.join(','), today],
    queryFn: ({ signal }) => discoverMovies(params, { signal }),
    staleTime: TMDB_STALE.DISCOVER,
    enabled,
  });

  return useMemo(() => {
    if (!enabled || !data) return { rowSpec, visible: [], backingPool: [], isLoading };
    const items = (data.results ?? []).map(r => ({ ...r, media_type: 'movie' as const })) as RowTitle[];
    const filtered = applyClientFilters(dedupeAndExclude(items, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [data, enabled, excludedIds, filters, rowSpec, isLoading]);
}
