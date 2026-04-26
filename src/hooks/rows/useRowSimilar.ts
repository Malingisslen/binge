'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getRecommendations, getSimilar } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters, scoreSimilarity } from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 50;

export function useRowSimilar(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const seed = rowSpec.id.kind === 'similar'
    ? { tmdbId: rowSpec.id.tmdbId, mediaType: rowSpec.id.mediaType }
    : null;
  const queries = useQueries({
    queries: [
      {
        queryKey: ['rec-recommendations', seed?.mediaType, seed?.tmdbId],
        queryFn: ({ signal }: { signal?: AbortSignal }) =>
          getRecommendations(seed!.mediaType, seed!.tmdbId, { signal }),
        staleTime: TMDB_STALE.RECOMMENDATIONS,
        enabled: !!seed,
      },
      {
        queryKey: ['rec-similar', seed?.mediaType, seed?.tmdbId],
        queryFn: ({ signal }: { signal?: AbortSignal }) =>
          getSimilar(seed!.mediaType, seed!.tmdbId, { signal }),
        staleTime: TMDB_STALE.RECOMMENDATIONS,
        enabled: !!seed,
      },
    ],
  });

  return useMemo(() => {
    const isLoading = queries.some(q => q.isLoading);
    if (!seed) return { rowSpec, visible: [], backingPool: [], isLoading: false };
    const recs = (queries[0]?.data?.results ?? []) as RowTitle[];
    const sims = (queries[1]?.data?.results ?? []) as RowTitle[];
    const scored: { t: RowTitle; s: number }[] = [];
    recs.forEach((t, i) => scored.push({ t: { ...t, media_type: seed.mediaType }, s: scoreSimilarity(i, 'recommendations') }));
    sims.forEach((t, i) => scored.push({ t: { ...t, media_type: seed.mediaType }, s: scoreSimilarity(i, 'similar') }));
    scored.sort((a, b) => b.s - a.s);
    const ranked = scored.map(x => x.t);
    const filtered = applyClientFilters(dedupeAndExclude(ranked, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [queries, seed, excludedIds, filters, rowSpec]);
}
