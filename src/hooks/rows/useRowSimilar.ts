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
  const seedTmdbId = rowSpec.id.kind === 'similar' ? rowSpec.id.tmdbId : null;
  const seedMediaType = rowSpec.id.kind === 'similar' ? rowSpec.id.mediaType : null;
  const seed = useMemo(
    () => seedTmdbId !== null && seedMediaType !== null
      ? { tmdbId: seedTmdbId, mediaType: seedMediaType }
      : null,
    [seedTmdbId, seedMediaType],
  );
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

  // Derive stable keys from query state to avoid memo recreation on every query change
  const recsData = queries[0]?.data?.results;
  const simsData = queries[1]?.data?.results;
  const isLoadingKey = (queries[0]?.isLoading || queries[1]?.isLoading) ? 1 : 0;

  return useMemo(() => {
    if (!seed) return { rowSpec, visible: [], backingPool: [], isLoading: false };
    const recs = (recsData ?? []) as RowTitle[];
    const sims = (simsData ?? []) as RowTitle[];
    const scored: { t: RowTitle; s: number }[] = [];
    recs.forEach((t, i) => {
      const tWithType = { ...t, media_type: seed.mediaType } as RowTitle;
      scored.push({ t: tWithType, s: scoreSimilarity(i, 'recommendations') });
    });
    sims.forEach((t, i) => {
      const tWithType = { ...t, media_type: seed.mediaType } as RowTitle;
      scored.push({ t: tWithType, s: scoreSimilarity(i, 'similar') });
    });
    scored.sort((a, b) => b.s - a.s);
    const ranked = scored.map(x => x.t);
    const filtered = applyClientFilters(dedupeAndExclude(ranked, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading: isLoadingKey === 1 };
  }, [recsData, simsData, isLoadingKey, seed, excludedIds, filters, rowSpec]);
}
