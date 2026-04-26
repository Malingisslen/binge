'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { discoverMovies, discoverTV } from '@/lib/tmdb/client';
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
  const wantMovies = filters.mediaType !== 'tv';
  const wantTV = filters.mediaType !== 'movie';

  const queries = useQueries({
    queries: [
      {
        queryKey: ['rec-upcoming-movie', myProviders.join(','), topGenreIds.join(','), today],
        queryFn: ({ signal }: { signal?: AbortSignal }) => discoverMovies({
          'primary_release_date.gte': today,
          with_watch_providers: myProviders.join('|'),
          watch_region: 'SE',
          sort_by: 'primary_release_date.asc',
          ...(topGenreIds.length ? { with_genres: topGenreIds.join('|') } : {}),
        }, { signal }),
        staleTime: TMDB_STALE.DISCOVER,
        enabled: enabled && wantMovies,
      },
      {
        queryKey: ['rec-upcoming-tv', myProviders.join(','), today],
        queryFn: ({ signal }: { signal?: AbortSignal }) => discoverTV({
          'first_air_date.gte': today,
          with_watch_providers: myProviders.join('|'),
          watch_region: 'SE',
          sort_by: 'first_air_date.asc',
        }, { signal }),
        staleTime: TMDB_STALE.DISCOVER,
        enabled: enabled && wantTV,
      },
    ],
  });

  const movieData = queries[0]?.data?.results;
  const tvData = queries[1]?.data?.results;
  const isLoading = queries.some(q => q.isLoading);

  return useMemo(() => {
    if (!enabled) return { rowSpec, visible: [], backingPool: [], isLoading: false };
    const items: RowTitle[] = [];
    if (movieData) items.push(...movieData.map(r => ({ ...r, media_type: 'movie' as const })));
    if (tvData) items.push(...tvData.map(r => ({ ...r, media_type: 'tv' as const })));
    items.sort((a, b) => {
      const ad = a.release_date ?? (a as RowTitle & { first_air_date?: string }).first_air_date ?? '';
      const bd = b.release_date ?? (b as RowTitle & { first_air_date?: string }).first_air_date ?? '';
      return ad.localeCompare(bd);
    });
    const filtered = applyClientFilters(dedupeAndExclude(items, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [movieData, tvData, isLoading, enabled, excludedIds, filters, rowSpec]);
}
