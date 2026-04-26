'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { discoverMovies, discoverTV } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters } from '@/lib/recommendations/rowComposition';
import { crossMediaGenreId } from '@/lib/tmdb/genreMapping';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 100;

function discoverParamsMovie(genreId: number | null, dateParams: Record<string, string>, voteParam: Record<string, string>, page: number): Record<string, string> {
  const p: Record<string, string> = {
    sort_by: 'vote_average.desc',
    'vote_count.gte': '2000',
    ...(genreId !== null ? { with_genres: String(genreId) } : {}),
    ...dateParams,
    ...voteParam,
  };
  if (page > 1) p.page = String(page);
  return p;
}
function discoverParamsTV(genreId: number | null, decade: string, voteParam: Record<string, string>, page: number): Record<string, string> {
  const p: Record<string, string> = {
    sort_by: 'vote_average.desc',
    'vote_count.gte': '500',
    ...(genreId !== null ? { with_genres: String(genreId) } : {}),
    ...(decade ? { 'first_air_date.gte': `${decade}-01-01`, 'first_air_date.lte': `${Number(decade) + 9}-12-31` } : {}),
    ...voteParam,
  };
  if (page > 1) p.page = String(page);
  return p;
}

/**
 * Genre-id på `RowSpec` kommer från användarens dominerande genre, beräknad på
 * blandad watchlist-data — vi vet inte säkert om det är en film- eller TV-genre.
 * Heuristik: om id:t finns i film-mappningen behandlar vi det som ett film-id;
 * annars som ett TV-id. För medietyp som inte matchar mappar vi via
 * `crossMediaGenreId`. Returnerar null om mappning saknas → den medietypen
 * skippas helt för raden.
 */
function genreIdsForQueries(
  genreId: number,
  filterMediaType: FilterState['mediaType'],
): { movieGenreId: number | null; tvGenreId: number | null } {
  // Vi gissar källans medietyp: om id:t är ≥ 10000 är det troligen TV (TMDB
  // använder höga id:n för TV-specifika genrer som Reality 10764, News 10763).
  // Låga id:n kan vara antingen — anta film som default.
  const looksLikeTv = genreId >= 10000 && genreId !== 10751 && genreId !== 10402 && genreId !== 10749 && genreId !== 10752 && genreId !== 10770;
  const sourceType = looksLikeTv ? 'tv' : 'movie';

  const movieGenreId = sourceType === 'movie' ? genreId : crossMediaGenreId(genreId, 'tv', 'movie');
  const tvGenreId = sourceType === 'tv' ? genreId : crossMediaGenreId(genreId, 'movie', 'tv');

  if (filterMediaType === 'movie') return { movieGenreId, tvGenreId: null };
  if (filterMediaType === 'tv') return { movieGenreId: null, tvGenreId };
  return { movieGenreId, tvGenreId };
}

export function useRowGenreCanon(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const genreId = rowSpec.id.kind === 'genre-canon' ? rowSpec.id.genreId : undefined;
  const { movieGenreId, tvGenreId } = genreId !== undefined
    ? genreIdsForQueries(genreId, filters.mediaType)
    : { movieGenreId: null, tvGenreId: null };

  const dateParams: Record<string, string> = filters.decade ? {
    'primary_release_date.gte': `${filters.decade}-01-01`,
    'primary_release_date.lte': `${Number(filters.decade) + 9}-12-31`,
  } : {};
  const voteParam: Record<string, string> = filters.voteAverageMin > 0 ? { 'vote_average.gte': String(filters.voteAverageMin) } : {};

  const queries = useQueries({
    queries: [
      { queryKey: ['rec-genre-canon-movie', movieGenreId, filters.decade, filters.voteAverageMin, 1], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverMovies(discoverParamsMovie(movieGenreId, dateParams, voteParam, 1), { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: movieGenreId !== null },
      { queryKey: ['rec-genre-canon-movie', movieGenreId, filters.decade, filters.voteAverageMin, 2], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverMovies(discoverParamsMovie(movieGenreId, dateParams, voteParam, 2), { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: movieGenreId !== null },
      { queryKey: ['rec-genre-canon-tv', tvGenreId, filters.decade, filters.voteAverageMin, 1], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverTV(discoverParamsTV(tvGenreId, filters.decade, voteParam, 1), { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: tvGenreId !== null },
      { queryKey: ['rec-genre-canon-tv', tvGenreId, filters.decade, filters.voteAverageMin, 2], queryFn: ({ signal }: { signal?: AbortSignal }) => discoverTV(discoverParamsTV(tvGenreId, filters.decade, voteParam, 2), { signal }), staleTime: TMDB_STALE.DISCOVER, enabled: tvGenreId !== null },
    ],
  });

  const movieP1 = queries[0]?.data?.results;
  const movieP2 = queries[1]?.data?.results;
  const tvP1 = queries[2]?.data?.results;
  const tvP2 = queries[3]?.data?.results;
  const isLoading = queries.some(q => q.isLoading);

  return useMemo(() => {
    if (genreId === undefined) return { rowSpec, visible: [], backingPool: [], isLoading: false };
    const items: RowTitle[] = [];
    [...(movieP1 ?? []), ...(movieP2 ?? [])].forEach(r => items.push({ ...r, media_type: 'movie' as const }));
    [...(tvP1 ?? []), ...(tvP2 ?? [])].forEach(r => items.push({ ...r, media_type: 'tv' as const }));
    items.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
    const filtered = applyClientFilters(dedupeAndExclude(items, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [movieP1, movieP2, tvP1, tvP2, isLoading, genreId, excludedIds, filters, rowSpec]);
}
