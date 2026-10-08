'use client';

import { useQuery } from '@tanstack/react-query';
import { getMovieGenres, getTVGenres } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { GENRE_LABELS } from '@/lib/tmdb/genreLabels';

export function useGenreMap(): Map<number, string> {
  const { data: movieGenres } = useQuery({
    queryKey: ['genres-movie'],
    queryFn: ({ signal }) => getMovieGenres({ signal }),
    staleTime: TMDB_STALE.GENRES,
  });
  const { data: tvGenres } = useQuery({
    queryKey: ['genres-tv'],
    queryFn: ({ signal }) => getTVGenres({ signal }),
    staleTime: TMDB_STALE.GENRES,
  });

  const map = new Map<number, string>();
  // TMDB leaves the series-only genres in English even in Swedish ("Kids"), so
  // the app's own Swedish name wins wherever there is one.
  for (const g of movieGenres?.genres ?? []) map.set(g.id, GENRE_LABELS[g.id] ?? g.name);
  for (const g of tvGenres?.genres ?? []) map.set(g.id, GENRE_LABELS[g.id] ?? g.name);
  return map;
}
