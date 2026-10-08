'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { discoverMovies, discoverTV } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters, scorePopularity } from '@/lib/recommendations/rowComposition';
import { discoverDateParams, discoverVoteParams, discoverKeyParts } from '@/lib/recommendations/discoverFilterParams';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 100;

function movieParams(keywordId: number | undefined, dateParams: Record<string, string>, voteParam: Record<string, string>, page: number): Record<string, string> {
  const p: Record<string, string> = {
    sort_by: 'popularity.desc',
    'vote_count.gte': '200',
    ...(keywordId !== undefined ? { with_keywords: String(keywordId) } : {}),
    ...dateParams,
    ...voteParam,
  };
  if (page > 1) p.page = String(page);
  return p;
}
function tvParams(keywordId: number | undefined, tvDateParams: Record<string, string>, voteParam: Record<string, string>, page: number): Record<string, string> {
  const p: Record<string, string> = {
    sort_by: 'popularity.desc',
    'vote_count.gte': '50',
    ...(keywordId !== undefined ? { with_keywords: String(keywordId) } : {}),
    ...tvDateParams,
    ...voteParam,
  };
  if (page > 1) p.page = String(page);
  return p;
}

export function useRowThematic(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<string>,
  filters: FilterState,
): RowResult {
  const keywordId = rowSpec.id.kind === 'thematic' ? rowSpec.id.keywordId : undefined;
  const wantMovies = filters.mediaType !== 'tv';
  const wantTV = filters.mediaType !== 'movie';

  const dateParams = discoverDateParams(filters, 'primary_release_date');
  const tvDateParams = discoverDateParams(filters, 'first_air_date');
  const voteParam = discoverVoteParams(filters);
  const keyParts = discoverKeyParts(filters);

  const queries = useQueries({
    queries: [
      { queryKey: ['rec-thematic-movie', keywordId, ...keyParts, 1], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverMovies(movieParams(keywordId, dateParams, voteParam, 1), { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: !!keywordId && wantMovies },
      { queryKey: ['rec-thematic-movie', keywordId, ...keyParts, 2], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverMovies(movieParams(keywordId, dateParams, voteParam, 2), { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: !!keywordId && wantMovies },
      { queryKey: ['rec-thematic-tv', keywordId, ...keyParts, 1], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverTV(tvParams(keywordId, tvDateParams, voteParam, 1), { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: !!keywordId && wantTV },
      { queryKey: ['rec-thematic-tv', keywordId, ...keyParts, 2], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverTV(tvParams(keywordId, tvDateParams, voteParam, 2), { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: !!keywordId && wantTV },
    ],
  });

  const movieP1 = queries[0]?.data?.results;
  const movieP2 = queries[1]?.data?.results;
  const tvP1 = queries[2]?.data?.results;
  const tvP2 = queries[3]?.data?.results;
  const isLoading = queries.some(q => q.isLoading);

  return useMemo(() => {
    if (!keywordId) return { rowSpec, visible: [], backingPool: [], isLoading: false };
    const items: RowTitle[] = [];
    [...(movieP1 ?? []), ...(movieP2 ?? [])].forEach(r => items.push({ ...r, media_type: 'movie' as const }));
    [...(tvP1 ?? []), ...(tvP2 ?? [])].forEach(r => items.push({ ...r, media_type: 'tv' as const }));
    items.sort((a, b) => scorePopularity(b) - scorePopularity(a));
    const filtered = applyClientFilters(dedupeAndExclude(items, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [movieP1, movieP2, tvP1, tvP2, isLoading, keywordId, excludedIds, filters, rowSpec]);
}
