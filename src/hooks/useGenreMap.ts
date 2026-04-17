'use client';

import { useQuery } from '@tanstack/react-query';
import { getMovieGenres, getTVGenres } from '@/lib/tmdb/client';

export function useGenreMap(): Map<number, string> {
  const { data: movieGenres } = useQuery({
    queryKey: ['genres-movie'],
    queryFn: getMovieGenres,
    staleTime: 60 * 60 * 1000,
  });
  const { data: tvGenres } = useQuery({
    queryKey: ['genres-tv'],
    queryFn: getTVGenres,
    staleTime: 60 * 60 * 1000,
  });

  const map = new Map<number, string>();
  for (const g of movieGenres?.genres ?? []) map.set(g.id, g.name);
  for (const g of tvGenres?.genres ?? []) map.set(g.id, g.name);
  return map;
}
