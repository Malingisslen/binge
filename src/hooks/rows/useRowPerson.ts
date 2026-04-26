'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPersonCredits } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters } from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle, TMDBSearchResult } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 60;

export function useRowPerson(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<number>,
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
    const crew = (data.crew ?? []).filter((c: any) => c.job === 'Director' && (c.media_type === 'movie' || c.media_type === 'tv')) as RowTitle[];
    const merged = [...cast, ...crew];
    merged.sort((a, b) => {
      const sa = (a.vote_average ?? 0) * Math.log((typeof (a as any).vote_count === 'number' ? (a as any).vote_count : 0) + 1);
      const sb = (b.vote_average ?? 0) * Math.log((typeof (b as any).vote_count === 'number' ? (b as any).vote_count : 0) + 1);
      return sb - sa;
    });
    const filtered = applyClientFilters(dedupeAndExclude(merged, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [data, personId, excludedIds, filters, rowSpec, isLoading]);
}
