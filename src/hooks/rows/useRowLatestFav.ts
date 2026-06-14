'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getRecommendations, getSimilar } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import {
  dedupeAndExclude,
  splitVisibleAndPool,
  applyClientFilters,
  composeSimilarPool,
} from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle, MediaType } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 100;

export function useRowLatestFav(
  rowSpec: RowSpec,
  seed: { tmdbId: number; mediaType: MediaType } | null,
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const queries = useQueries({
    queries: [
      { queryKey: ['rec-recommendations', seed?.mediaType, seed?.tmdbId, 1], queryFn: ({ signal }: { signal?: AbortSignal }) => getRecommendations(seed!.mediaType, seed!.tmdbId, { signal, page: 1 }), staleTime: TMDB_STALE.RECOMMENDATIONS, enabled: !!seed },
      { queryKey: ['rec-recommendations', seed?.mediaType, seed?.tmdbId, 2], queryFn: ({ signal }: { signal?: AbortSignal }) => getRecommendations(seed!.mediaType, seed!.tmdbId, { signal, page: 2 }), staleTime: TMDB_STALE.RECOMMENDATIONS, enabled: !!seed },
      { queryKey: ['rec-similar', seed?.mediaType, seed?.tmdbId, 1], queryFn: ({ signal }: { signal?: AbortSignal }) => getSimilar(seed!.mediaType, seed!.tmdbId, { signal, page: 1 }), staleTime: TMDB_STALE.RECOMMENDATIONS, enabled: !!seed },
      { queryKey: ['rec-similar', seed?.mediaType, seed?.tmdbId, 2], queryFn: ({ signal }: { signal?: AbortSignal }) => getSimilar(seed!.mediaType, seed!.tmdbId, { signal, page: 2 }), staleTime: TMDB_STALE.RECOMMENDATIONS, enabled: !!seed },
    ],
  });

  const recsP1 = queries[0]?.data?.results;
  const recsP2 = queries[1]?.data?.results;
  const simsP1 = queries[2]?.data?.results;
  const simsP2 = queries[3]?.data?.results;
  const isLoadingKey = queries.some(q => q.isLoading) ? 1 : 0;

  return useMemo(() => {
    if (!seed) return { rowSpec, visible: [], backingPool: [], isLoading: false };
    const withType = (arr: typeof recsP1) =>
      (arr ?? []).map(t => ({ ...t, media_type: seed.mediaType }) as RowTitle);
    const recs = [...withType(recsP1), ...withType(recsP2)];
    const sims = [...withType(simsP1), ...withType(simsP2)];
    const ranked = composeSimilarPool(recs, sims);
    const filtered = applyClientFilters(dedupeAndExclude(ranked, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading: isLoadingKey === 1 };
  }, [recsP1, recsP2, simsP1, simsP2, isLoadingKey, seed, excludedIds, filters, rowSpec]);
}
