'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { discoverMovies } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters } from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 50;

export function useRowThematic(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const keywordId = rowSpec.id.kind === 'thematic' ? rowSpec.id.keywordId : undefined;

  const params: Record<string, string> = {
    sort_by: 'popularity.desc',
    'vote_count.gte': '200',
    ...(keywordId !== undefined ? { with_keywords: String(keywordId) } : {}),
    ...(filters.decade ? {
      'primary_release_date.gte': `${filters.decade}-01-01`,
      'primary_release_date.lte': `${Number(filters.decade) + 9}-12-31`,
    } : {}),
    ...(filters.voteAverageMin > 0 ? { 'vote_average.gte': String(filters.voteAverageMin) } : {}),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['rec-thematic', keywordId, filters.decade, filters.voteAverageMin],
    queryFn: ({ signal }) => discoverMovies(params, { signal }),
    staleTime: TMDB_STALE.DISCOVER,
    enabled: !!keywordId,
  });

  return useMemo(() => {
    if (!keywordId || !data) return { rowSpec, visible: [], backingPool: [], isLoading };
    const items = (data.results ?? []).map(r => ({ ...r, media_type: 'movie' as const })) as RowTitle[];
    items.sort((a, b) => {
      const sa = (a.vote_average ?? 0) * Math.log((typeof (a as any).vote_count === 'number' ? (a as any).vote_count : 0) + 1);
      const sb = (b.vote_average ?? 0) * Math.log((typeof (b as any).vote_count === 'number' ? (b as any).vote_count : 0) + 1);
      return sb - sa;
    });
    const filtered = applyClientFilters(dedupeAndExclude(items, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [data, keywordId, excludedIds, filters, rowSpec, isLoading]);
}
