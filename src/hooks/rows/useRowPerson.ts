'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPersonCredits } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters, scorePopularity } from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle, TMDBSearchResult } from '@/types';

type CrewWithJob = TMDBSearchResult & { job?: string };

const VISIBLE_CAP = 20;
const POOL_TARGET = 60;

export function useRowPerson(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<string>,
  filters: FilterState,
): RowResult {
  const personId = rowSpec.id.kind === 'person' ? rowSpec.id.personId : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['rec-person-credits', personId],
    queryFn: ({ signal }) => getPersonCredits(personId!, { signal }),
    staleTime: TMDB_STALE.PERSON_CREDITS,
    enabled: !!personId,
  });

  return useMemo(() => {
    if (!personId || !data) return { rowSpec, visible: [], backingPool: [], isLoading };
    const cast = (data.cast ?? []) as RowTitle[];
    const crew = (data.crew ?? [])
      .filter((c: CrewWithJob): c is CrewWithJob & { media_type: 'movie' | 'tv' } =>
        c.job === 'Director' && (c.media_type === 'movie' || c.media_type === 'tv')
      ) as RowTitle[];
    const merged = [...cast, ...crew];
    merged.sort((a, b) => scorePopularity(b) - scorePopularity(a));
    const filtered = applyClientFilters(dedupeAndExclude(merged, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [data, personId, excludedIds, filters, rowSpec, isLoading]);
}
