'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import AuthGuard from '@/components/AuthGuard';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { getRecommendations } from '@/lib/tmdb/client';
import RecommendationsSection from '@/components/title/RecommendationsSection';

export default function RecommendationsPage() {
  return <AuthGuard><RecsContent /></AuthGuard>;
}

function RecsContent() {
  const { items } = useWatchlist();
  const { user } = useAuth();
  const myProviders = user?.myProviders ?? [];

  // Pick top-rated items as seeds (up to 5)
  const seeds = useMemo(() =>
    items
      .filter(i => i.rating !== null && i.rating >= 3)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, 5),
    [items]
  );

  const watchedIds = useMemo(() => new Set(items.map(i => i.tmdbId)), [items]);

  // Fetch recommendations for each seed
  const recQueries = useQueries({
    queries: seeds.map(seed => ({
      queryKey: ['recommendations', seed.mediaType, seed.tmdbId],
      queryFn: () => getRecommendations(seed.mediaType, seed.tmdbId),
      staleTime: 30 * 60 * 1000,
    })),
  });

  // Deduplicate and exclude already-tracked titles
  const allRecs = useMemo(() => {
    const seen = new Set<string>();
    const result: (import('@/types').TMDBSearchResult & { media_type: 'movie' | 'tv' })[] = [];

    seeds.forEach((seed, i) => {
      const data = recQueries[i]?.data?.results;
      if (!data) return;
      for (const item of data) {
        const mt = item.media_type || seed.mediaType;
        if (mt !== 'movie' && mt !== 'tv') continue;
        const key = `${mt}-${item.id}`;
        if (seen.has(key) || watchedIds.has(item.id)) continue;
        seen.add(key);
        result.push({ ...item, media_type: mt });
      }
    });

    return result.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0)).slice(0, 20);
  }, [seeds, recQueries, watchedIds]);

  const isLoading = recQueries.some(q => q.isLoading);

  return (
    <div>
      <h1 className="text-md font-bold text-text-primary mb-1">Rekommendationer</h1>
      <p className="text-xs text-text-muted mb-3">
        Baserat på dina högst betygsatta titlar, exklusive det du redan följer.
      </p>

      {isLoading && allRecs.length === 0 ? (
        <div className="text-sm text-text-muted py-4">Laddar rekommendationer...</div>
      ) : allRecs.length === 0 ? (
        <div className="text-sm text-text-muted py-4">
          Betygsätt fler titlar för att få personliga rekommendationer.
        </div>
      ) : (
        <RecommendationsSection
          recommendations={allRecs}
          myProviders={myProviders}
          label={`${allRecs.length} förslag`}
        />
      )}
    </div>
  );
}
