'use client';

// BIN-583 — "Fortsätter som film": the curated TV↔film companion row.
//
// Unlike every other cascade row this one does NOT discover anything — the
// titles are decided offline by `selectCompanionAnchors` before the row is even
// emitted. All this hook does is turn a handful of curated film ids into row
// titles, so the fan-out is bounded by COMPANION_FILM_CAP and shares the
// ['movie-lite', id] cache with the title-page CompanionSection (same query key,
// same staleTime) — a user who came from a title page pays nothing here.

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getMovieLite } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import {
  dedupeAndExclude,
  splitVisibleAndPool,
  applyClientFilters,
} from '@/lib/recommendations/rowComposition';
import { toRowTitle } from './useRowCompanion.helpers';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;

export function useRowCompanion(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<string>,
  filters: FilterState,
): RowResult {
  const films = useMemo(
    () => (rowSpec.meta?.companions ?? []).flatMap(a => a.films),
    [rowSpec],
  );

  const queries = useQueries({
    queries: films.map(f => ({
      queryKey: ['movie-lite', f.id],
      queryFn: ({ signal }: { signal?: AbortSignal }) => getMovieLite(f.id, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
    })),
  });

  // Stable keys derived from the query array — `queries` itself is a fresh array
  // every render (see useRecommendationsCascade for the same pattern).
  const dataKey = queries.map(q => (q.data ? 'd' : '')).join(',');
  const isLoading = queries.some(q => q.isLoading);

  return useMemo(() => {
    const items: RowTitle[] = [];
    films.forEach((_, i) => {
      const data = queries[i]?.data;
      if (data) items.push(toRowTitle(data));
    });
    // Curated (chronological) order is kept deliberately — this row's value is
    // the story order of the franchise, not a popularity ranking.
    const filtered = applyClientFilters(dedupeAndExclude(items, excludedIds), filters);
    const split = splitVisibleAndPool(filtered, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [films, dataKey, isLoading, excludedIds, filters, rowSpec]);
}
