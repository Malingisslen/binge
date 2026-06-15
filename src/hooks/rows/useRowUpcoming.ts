'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { discoverMovies, discoverTV } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters } from '@/lib/recommendations/rowComposition';
import { localIsoDate } from '@/lib/utils';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 100;

function movieParams(today: string, providers: readonly number[], topGenreIds: readonly number[], page: number): Record<string, string> {
  const p: Record<string, string> = {
    'primary_release_date.gte': today,
    with_watch_providers: providers.join('|'),
    watch_region: 'SE',
    sort_by: 'primary_release_date.asc',
    ...(topGenreIds.length ? { with_genres: topGenreIds.join('|') } : {}),
  };
  if (page > 1) p.page = String(page);
  return p;
}
function tvParams(today: string, providers: readonly number[], page: number): Record<string, string> {
  const p: Record<string, string> = {
    'first_air_date.gte': today,
    with_watch_providers: providers.join('|'),
    watch_region: 'SE',
    sort_by: 'first_air_date.asc',
  };
  if (page > 1) p.page = String(page);
  return p;
}

export function useRowUpcoming(
  rowSpec: RowSpec,
  myProviders: readonly number[],
  topGenreIds: readonly number[],
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const today = localIsoDate(new Date());
  const enabled = myProviders.length > 0;
  const wantMovies = filters.mediaType !== 'tv';
  const wantTV = filters.mediaType !== 'movie';

  const queries = useQueries({
    queries: [
      { queryKey: ['rec-upcoming-movie', myProviders.join(','), topGenreIds.join(','), today, 1], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverMovies(movieParams(today, myProviders, topGenreIds, 1), { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: enabled && wantMovies },
      { queryKey: ['rec-upcoming-movie', myProviders.join(','), topGenreIds.join(','), today, 2], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverMovies(movieParams(today, myProviders, topGenreIds, 2), { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: enabled && wantMovies },
      { queryKey: ['rec-upcoming-tv', myProviders.join(','), today, 1], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverTV(tvParams(today, myProviders, 1), { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: enabled && wantTV },
      { queryKey: ['rec-upcoming-tv', myProviders.join(','), today, 2], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverTV(tvParams(today, myProviders, 2), { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: enabled && wantTV },
    ],
  });

  const movieP1 = queries[0]?.data?.results;
  const movieP2 = queries[1]?.data?.results;
  const tvP1 = queries[2]?.data?.results;
  const tvP2 = queries[3]?.data?.results;
  const isLoading = queries.some(q => q.isLoading);

  return useMemo(() => {
    if (!enabled) return { rowSpec, visible: [], backingPool: [], isLoading: false };
    const items: RowTitle[] = [];
    [...(movieP1 ?? []), ...(movieP2 ?? [])].forEach(r => items.push({ ...r, media_type: 'movie' as const }));
    [...(tvP1 ?? []), ...(tvP2 ?? [])].forEach(r => items.push({ ...r, media_type: 'tv' as const }));
    items.sort((a, b) => {
      const ad = a.release_date ?? (a as RowTitle & { first_air_date?: string }).first_air_date ?? '';
      const bd = b.release_date ?? (b as RowTitle & { first_air_date?: string }).first_air_date ?? '';
      return ad.localeCompare(bd);
    });
    const filtered = applyClientFilters(dedupeAndExclude(items, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [movieP1, movieP2, tvP1, tvP2, isLoading, enabled, excludedIds, filters, rowSpec]);
}
