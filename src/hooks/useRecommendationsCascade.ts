'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { getCredits, getKeywords, discoverMovies } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import {
  classifySeeds,
  capRecentSeeds,
  detectLatestFiveStar,
  detectRecurringPeople,
  detectRecurringKeywords,
  detectDominantGenres,
  type SeedCredits,
} from '@/lib/recommendations/seedAnalysis';
import { prioritizeRows } from '@/lib/recommendations/cascadePrioritizer';
import type { RowSpec } from '@/types';

const FIVE_STAR_WINDOW_DAYS = 30;

// Bound the per-seed TMDB fan-out (credits + keywords) to the N most-recently-
// rated seeds. Recurring-people/keyword detection only surfaces the top 3, so
// seeds beyond this add cost with ~zero marginal value. The full strong/weak
// lists are still used for ratingCount and the top-3 "similar" rows.
const SEED_FETCH_CAP = 20;

export interface CascadeOutput {
  rows: RowSpec[];
  ratingCount: number;
  topGenreIds: number[];
  hasMyProviders: boolean;
  /**
   * Sant medan detalj-/keyword-queries för seed-titlarna fortfarande laddar.
   * OBS: täcker INTE watchlist-snapshotens laddning — konsumenter som vill
   * gate:a rendering på "allt klart" måste OR:a med WatchlistContext.loading
   * (se RecommendationsHub.rowsPending). Med tom watchlist är denna false
   * redan innan snapshotten landat.
   */
  isLoadingDetection: boolean;
  latestFiveStar: { tmdbId: number; mediaType: 'movie' | 'tv'; title: string; daysSince: number } | null;
}

export function useRecommendationsCascade(): CascadeOutput {
  const { items } = useWatchlist();
  const { user } = useAuth();
  const myProviders = useMemo(() => user?.myProviders ?? [], [user?.myProviders]);

  const { strong, weak } = useMemo(() => classifySeeds(items), [items]);
  const allSeeds = useMemo(() => [...strong, ...weak], [strong, weak]);

  // Capped seed lists for the expensive per-seed fan-out only. The full
  // strong/weak lists drive ratingCount + the top-3 "similar" rows untouched.
  const strongForFetch = useMemo(() => capRecentSeeds(strong, SEED_FETCH_CAP), [strong]);
  const seedsForFetch = useMemo(() => capRecentSeeds(allSeeds, SEED_FETCH_CAP), [allSeeds]);

  // Per-seed credits fetch — standalone /credits endpoint (lite), not full detail
  const creditsQueries = useQueries({
    queries: strongForFetch.map(s => ({
      queryKey: ['rec-credits', s.mediaType, s.tmdbId],
      queryFn: ({ signal }: { signal?: AbortSignal }) => getCredits(s.mediaType, s.tmdbId, { signal }),
      staleTime: TMDB_STALE.CREDITS,
    })),
  });

  // Per-seed keyword fetch (separate endpoint, longer cache)
  const keywordQueries = useQueries({
    queries: seedsForFetch.map(s => ({
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
  const detailDataKey = creditsQueries.map(q => q.data ? 'd' : '').join(',');
  const detailLoadingKey = creditsQueries.some(q => q.isLoading) ? 1 : 0;
  const keywordDataKey = keywordQueries.map(q => q.data ? 'k' : '').join(',');
  const keywordLoadingKey = keywordQueries.some(q => q.isLoading) ? 1 : 0;
  const upcomingDataLength = upcomingProbeQuery[0]?.data?.results?.length ?? 0;

  return useMemo(() => {
    const isLoadingDetection = detailLoadingKey === 1 || keywordLoadingKey === 1;

    // Build SeedCredits map from the standalone /credits responses ({cast, crew})
    const credits = new Map<number, SeedCredits>();
    strongForFetch.forEach((s, i) => {
      const data = creditsQueries[i]?.data;
      if (!data) return;
      const crew = data.crew ?? [];
      const directorEntry = crew.find(c => c.job === 'Director');
      credits.set(s.tmdbId, {
        cast: (data.cast ?? []).map(c => ({ id: c.id, name: c.name })),
        director: directorEntry ? { id: directorEntry.id, name: directorEntry.name } : null,
      });
    });

    // Build keyword map
    const keywordsByTmdb = new Map<number, { id: number; name: string }[]>();
    seedsForFetch.forEach((s, i) => {
      const data = keywordQueries[i]?.data;
      if (data) keywordsByTmdb.set(s.tmdbId, data);
    });

    const recurringPeople = detectRecurringPeople(strongForFetch, credits, 3);
    const recurringKeywords = detectRecurringKeywords(seedsForFetch, keywordsByTmdb, 3);
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
    // creditsQueries / keywordQueries are intentionally NOT in deps — they're
    // fresh arrays from useQueries each render, defeating memoization. The
    // derived *DataKey / *LoadingKey above capture the semantic state change
    // (which queries have data, which are loading) without unstable references.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, strong, weak, strongForFetch, seedsForFetch, detailDataKey, detailLoadingKey, keywordDataKey, keywordLoadingKey, upcomingDataLength, myProviders]);
}
