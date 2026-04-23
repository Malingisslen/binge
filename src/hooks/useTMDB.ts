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
} from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';

export function useSearch(query: string, page = 1) {
  return useQuery({
    queryKey: ['search', query, page],
    queryFn: () => searchMulti(query, page),
    enabled: query.length >= 2,
    staleTime: TMDB_STALE.SEARCH,
  });
}

export function useMovie(id: number | null) {
  return useQuery({
    queryKey: ['movie', id],
    queryFn: () => getMovie(id!),
    enabled: id !== null,
    staleTime: TMDB_STALE.MOVIE_DETAIL,
  });
}

export function useTVShow(id: number | null) {
  return useQuery({
    queryKey: ['tv', id],
    queryFn: () => getTVShow(id!),
    enabled: id !== null,
    staleTime: TMDB_STALE.TV_DETAIL,
  });
}

export function useTVSeason(seriesId: number | null, seasonNumber: number | null) {
  return useQuery({
    queryKey: ['tv-season', seriesId, seasonNumber],
    queryFn: () => getTVSeason(seriesId!, seasonNumber!),
    enabled: seriesId !== null && seasonNumber !== null,
    staleTime: TMDB_STALE.SEASON,
  });
}

export function useTrending(mediaType: 'all' | 'movie' | 'tv' = 'all', timeWindow: 'day' | 'week' = 'week') {
  return useQuery({
    queryKey: ['trending', mediaType, timeWindow],
    queryFn: () => getTrending(mediaType, timeWindow),
    staleTime: TMDB_STALE.CATALOG,
  });
}

export function usePopularMovies(page = 1) {
  return useQuery({
    queryKey: ['popular-movies', page],
    queryFn: () => getPopularMovies(page),
    staleTime: TMDB_STALE.CATALOG,
  });
}

export function usePopularTV(page = 1) {
  return useQuery({
    queryKey: ['popular-tv', page],
    queryFn: () => getPopularTV(page),
    staleTime: TMDB_STALE.CATALOG,
  });
}

export function useDiscoverMovies(params: Record<string, string> | null = {}) {
  return useQuery({
    queryKey: ['discover-movies', params],
    queryFn: () => discoverMovies(params!),
    enabled: params !== null,
    staleTime: TMDB_STALE.CATALOG,
  });
}

export function useDiscoverTV(params: Record<string, string> | null = {}) {
  return useQuery({
    queryKey: ['discover-tv', params],
    queryFn: () => discoverTV(params!),
    enabled: params !== null,
    staleTime: TMDB_STALE.CATALOG,
  });
}

export function usePerson(id: number | null) {
  return useQuery({
    queryKey: ['person', id],
    queryFn: () => getPerson(id!),
    enabled: id !== null,
    staleTime: TMDB_STALE.PERSON,
  });
}

export function usePersonCredits(id: number | null) {
  return useQuery({
    queryKey: ['person-credits', id],
    queryFn: () => getPersonCredits(id!),
    enabled: id !== null,
    staleTime: TMDB_STALE.PERSON,
  });
}
