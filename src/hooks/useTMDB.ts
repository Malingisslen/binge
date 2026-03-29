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

const STALE_TIME = 5 * 60 * 1000; // 5 minutes

export function useSearch(query: string, page = 1) {
  return useQuery({
    queryKey: ['search', query, page],
    queryFn: () => searchMulti(query, page),
    enabled: query.length >= 2,
    staleTime: STALE_TIME,
  });
}

export function useMovie(id: number | null) {
  return useQuery({
    queryKey: ['movie', id],
    queryFn: () => getMovie(id!),
    enabled: id !== null,
    staleTime: STALE_TIME,
  });
}

export function useTVShow(id: number | null) {
  return useQuery({
    queryKey: ['tv', id],
    queryFn: () => getTVShow(id!),
    enabled: id !== null,
    staleTime: STALE_TIME,
  });
}

export function useTVSeason(seriesId: number | null, seasonNumber: number | null) {
  return useQuery({
    queryKey: ['tv-season', seriesId, seasonNumber],
    queryFn: () => getTVSeason(seriesId!, seasonNumber!),
    enabled: seriesId !== null && seasonNumber !== null,
    staleTime: STALE_TIME,
  });
}

export function useTrending(mediaType: 'all' | 'movie' | 'tv' = 'all', timeWindow: 'day' | 'week' = 'week') {
  return useQuery({
    queryKey: ['trending', mediaType, timeWindow],
    queryFn: () => getTrending(mediaType, timeWindow),
    staleTime: STALE_TIME,
  });
}

export function usePopularMovies(page = 1) {
  return useQuery({
    queryKey: ['popular-movies', page],
    queryFn: () => getPopularMovies(page),
    staleTime: STALE_TIME,
  });
}

export function usePopularTV(page = 1) {
  return useQuery({
    queryKey: ['popular-tv', page],
    queryFn: () => getPopularTV(page),
    staleTime: STALE_TIME,
  });
}

export function useDiscoverMovies(params: Record<string, string> | null = {}) {
  return useQuery({
    queryKey: ['discover-movies', params],
    queryFn: () => discoverMovies(params!),
    enabled: params !== null,
    staleTime: STALE_TIME,
  });
}

export function useDiscoverTV(params: Record<string, string> | null = {}) {
  return useQuery({
    queryKey: ['discover-tv', params],
    queryFn: () => discoverTV(params!),
    enabled: params !== null,
    staleTime: STALE_TIME,
  });
}

export function usePerson(id: number | null) {
  return useQuery({
    queryKey: ['person', id],
    queryFn: () => getPerson(id!),
    enabled: id !== null,
    staleTime: STALE_TIME,
  });
}

export function usePersonCredits(id: number | null) {
  return useQuery({
    queryKey: ['person-credits', id],
    queryFn: () => getPersonCredits(id!),
    enabled: id !== null,
    staleTime: STALE_TIME,
  });
}
