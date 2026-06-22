'use client';

import { useQuery } from '@tanstack/react-query';
import {
  searchMulti,
  getMovie,
  getTVShow,
  getTVSeason,
  getTrending,
  getPopularMovies,
  getPopularTV,
  discoverMovies,
  discoverTV,
  getPerson,
  getPersonCredits,
  getCollection,
} from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import type { TMDBMovie, TMDBTVShow, TMDBPerson } from '@/types';

export function useSearch(query: string, page = 1) {
  return useQuery({
    queryKey: ['search', query, page],
    queryFn: ({ signal }) => searchMulti(query, page, { signal }),
    enabled: query.length >= 2,
    staleTime: TMDB_STALE.SEARCH,
  });
}

export function useMovie(id: number | null, initialData?: TMDBMovie) {
  return useQuery({
    queryKey: ['movie', id],
    queryFn: ({ signal }) => getMovie(id!, { signal }),
    enabled: id !== null,
    staleTime: TMDB_STALE.MOVIE_DETAIL,
    initialData,
  });
}

export function useTVShow(id: number | null, initialData?: TMDBTVShow) {
  return useQuery({
    queryKey: ['tv', id],
    queryFn: ({ signal }) => getTVShow(id!, { signal }),
    enabled: id !== null,
    staleTime: TMDB_STALE.TV_DETAIL,
    initialData,
  });
}

export function useTVSeason(seriesId: number | null, seasonNumber: number | null) {
  return useQuery({
    queryKey: ['tv-season', seriesId, seasonNumber],
    queryFn: ({ signal }) => getTVSeason(seriesId!, seasonNumber!, { signal }),
    enabled: seriesId !== null && seasonNumber !== null,
    staleTime: TMDB_STALE.SEASON,
  });
}

export function useTrending(mediaType: 'all' | 'movie' | 'tv' = 'all', timeWindow: 'day' | 'week' = 'week') {
  return useQuery({
    queryKey: ['trending', mediaType, timeWindow],
    queryFn: ({ signal }) => getTrending(mediaType, timeWindow, { signal }),
    staleTime: TMDB_STALE.CATALOG,
  });
}

export function usePopularMovies(page = 1) {
  return useQuery({
    queryKey: ['popular-movies', page],
    queryFn: ({ signal }) => getPopularMovies(page, { signal }),
    staleTime: TMDB_STALE.CATALOG,
  });
}

export function usePopularTV(page = 1) {
  return useQuery({
    queryKey: ['popular-tv', page],
    queryFn: ({ signal }) => getPopularTV(page, { signal }),
    staleTime: TMDB_STALE.CATALOG,
  });
}

export function useDiscoverMovies(params: Record<string, string> | null = {}) {
  return useQuery({
    queryKey: ['discover-movies', params],
    queryFn: ({ signal }) => discoverMovies(params!, { signal }),
    enabled: params !== null,
    staleTime: TMDB_STALE.CATALOG,
  });
}

export function useDiscoverTV(params: Record<string, string> | null = {}) {
  return useQuery({
    queryKey: ['discover-tv', params],
    queryFn: ({ signal }) => discoverTV(params!, { signal }),
    enabled: params !== null,
    staleTime: TMDB_STALE.CATALOG,
  });
}

export function usePerson(id: number | null, initialData?: TMDBPerson) {
  return useQuery({
    queryKey: ['person', id],
    queryFn: ({ signal }) => getPerson(id!, { signal }),
    enabled: id !== null,
    staleTime: TMDB_STALE.PERSON,
    initialData,
  });
}

export function useCollection(id: number | null) {
  return useQuery({
    queryKey: ['collection', id],
    queryFn: ({ signal }) => getCollection(id!, { signal }),
    enabled: id !== null,
    staleTime: TMDB_STALE.COLLECTION,
  });
}

export function usePersonCredits(id: number | null) {
  return useQuery({
    queryKey: ['person-credits', id],
    queryFn: ({ signal }) => getPersonCredits(id!, { signal }),
    enabled: id !== null,
    staleTime: TMDB_STALE.PERSON,
  });
}
