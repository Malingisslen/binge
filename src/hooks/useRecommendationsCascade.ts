'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { getMovie, getTVShow, getKeywords, discoverMovies } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import {
  classifySeeds,
  detectLatestFiveStar,
  detectRecurringPeople,
  detectRecurringKeywords,
  detectDominantGenres,
  type SeedCredits,
} from '@/lib/recommendations/seedAnalysis';
import { prioritizeRows } from '@/lib/recommendations/cascadePrioritizer';
import type { RowSpec } from '@/types';

const FIVE_STAR_WINDOW_DAYS = 30;

export interface CascadeOutput {
  rows: RowSpec[];
  ratingCount: number;
  topGenreIds: number[];
  hasMyProviders: boolean;
  isLoadingDetection: boolean;
  latestFiveStar: { tmdbId: number; mediaType: 'movie' | 'tv'; daysSince: number } | null;
}

export function useRecommendationsCascade(): CascadeOutput {
  const { items } = useWatchlist();
  const { user } = useAuth();
  const myProviders = useMemo(() => user?.myProviders ?? [], [user?.myProviders]);

  const { strong, weak } = useMemo(() => classifySeeds(items), [items]);
  const allSeeds = useMemo(() => [...strong, ...weak], [strong, weak]);

  // Per-strong-seed detail fetch — pulls credits from existing TV/Movie cache
  const detailQueries = useQueries({
    queries: strong.map(s => ({
      queryKey: [s.mediaType, s.tmdbId],
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        s.mediaType === 'movie' ? getMovie(s.tmdbId, { signal }) : getTVShow(s.tmdbId, { signal }),
      staleTime: s.mediaType === 'movie' ? TMDB_STALE.MOVIE_DETAIL : TMDB_STALE.TV_DETAIL,
    })),
  });

  // Per-seed keyword fetch (separate endpoint, longer cache)
  const keywordQueries = useQueries({
    queries: allSeeds.map(s => ({
      queryKey: ['rec-keywords', s.mediaType, s.tmdbId],
      queryFn: ({ signal }: { signal?: AbortSignal }) => getKeywords(s.mediaType, s.tmdbId, { signal }),
      staleTime: TMDB_STALE.KEYWORDS,
    })),
  });

  // Upcoming-count probe — single discover call
  const today = new Date().toISOString().slice(0, 10);
  const upcomingProbeQuery = useQueries({
    queries: [{
      queryKey: ['rec-upcoming-count', myProviders.join(','), today],
      queryFn: ({ signal }: { signal?: AbortSignal }) => discoverMovies({
        'primary_release_date.gte': today,
        with_watch_providers: myProviders.join('|'),
        watch_region: 'SE',
      }, { signal }),
      staleTime: TMDB_STALE.DISCOVER,
      enabled: myProviders.length > 0,
    }],
  });

  // Derive stable keys from query arrays to avoid recreating memo on every query state change
  const detailDataKey = detailQueries.map(q => q.data ? 'd' : '').join(',');
  const detailLoadingKey = detailQueries.some(q => q.isLoading) ? 1 : 0;
  const keywordDataKey = keywordQueries.map(q => q.data ? 'k' : '').join(',');
  const keywordLoadingKey = keywordQueries.some(q => q.isLoading) ? 1 : 0;
  const upcomingDataLength = upcomingProbeQuery[0]?.data?.results?.length ?? 0;

  return useMemo(() => {
    const isLoadingDetection = detailLoadingKey === 1 || keywordLoadingKey === 1;

    // Build SeedCredits map from detail queries
    const credits = new Map<number, SeedCredits>();
    strong.forEach((s, i) => {
      const data = detailQueries[i]?.data as
        | { credits?: { cast?: { id: number; name: string }[]; crew?: { id: number; name: string; job?: string }[] } }
        | undefined;
      if (!data?.credits) return;
      const crew = data.credits.crew ?? [];
      const directorEntry = crew.find(c => c.job === 'Director');
      credits.set(s.tmdbId, {
        cast: (data.credits.cast ?? []).map(c => ({ id: c.id, name: c.name })),
        director: directorEntry ? { id: directorEntry.id, name: directorEntry.name } : null,
      });
    });

    // Build keyword map
    const keywordsByTmdb = new Map<number, { id: number; name: string }[]>();
    allSeeds.forEach((s, i) => {
      const data = keywordQueries[i]?.data;
      if (data) keywordsByTmdb.set(s.tmdbId, data);
    });

    const recurringPeople = detectRecurringPeople(strong, credits, 3);
    const recurringKeywords = detectRecurringKeywords(allSeeds, keywordsByTmdb, 3);
    const dominantGenres = detectDominantGenres(items, 5);
    const latestFiveStar = detectLatestFiveStar(items, new Date(), FIVE_STAR_WINDOW_DAYS);

    const rows = prioritizeRows({
      latestFiveStar,
      strongSeeds: strong,
      weakSeeds: weak,
      recurringPeople,
      recurringKeywords,
      dominantGenres,
      hasMyProviders: myProviders.length > 0,
      upcomingCount: upcomingDataLength,
    });

    return {
      rows,
      ratingCount: strong.length + weak.length,
      topGenreIds: dominantGenres.slice(0, 3).map(g => g.id),
      hasMyProviders: myProviders.length > 0,
      isLoadingDetection,
      latestFiveStar,
    };
    // detailQueries / keywordQueries are intentionally NOT in deps — they're
    // fresh arrays from useQueries each render, defeating memoization. The
    // derived *DataKey / *LoadingKey above capture the semantic state change
    // (which queries have data, which are loading) without unstable references.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, strong, weak, allSeeds, detailDataKey, detailLoadingKey, keywordDataKey, keywordLoadingKey, upcomingDataLength, myProviders]);
}
