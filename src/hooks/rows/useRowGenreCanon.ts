'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { discoverMovies } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters } from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 50;

export function useRowGenreCanon(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const genreId = rowSpec.id.kind === 'genre-canon' ? rowSpec.id.genreId : undefined;

  const params: Record<string, string> = {
    sort_by: 'vote_average.desc',
    'vote_count.gte': '2000',
    ...(genreId !== undefined ? { with_genres: String(genreId) } : {}),
    ...(filters.decade ? {
      'primary_release_date.gte': `${filters.decade}-01-01`,
      'primary_release_date.lte': `${Number(filters.decade) + 9}-12-31`,
    } : {}),
    ...(filters.voteAverageMin > 0 ? { 'vote_average.gte': String(filters.voteAverageMin) } : {}),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['rec-genre-canon', genreId, filters.decade, filters.voteAverageMin],
    queryFn: ({ signal }) => discoverMovies(params, { signal }),
    staleTime: TMDB_STALE.DISCOVER,
    enabled: !!genreId,
  });

  return useMemo(() => {
    if (!genreId || !data) return { rowSpec, visible: [], backingPool: [], isLoading };
    const items = (data.results ?? []).map(r => ({ ...r, media_type: 'movie' as const })) as RowTitle[];
    const filtered = applyClientFilters(dedupeAndExclude(items, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [data, genreId, excludedIds, filters, rowSpec, isLoading]);
}
