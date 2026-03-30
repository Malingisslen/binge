'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { getTVShow } from '@/lib/tmdb/client';
import { getProvider } from '@/lib/tmdb/providers';
import type { TMDBTVShow, AdvisedShow, ProviderAdvisory, SubscribeAdvisory, AdvisorResult } from '@/types';

function isEnded(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'ended' || s === 'canceled';
}

function getNextAirInfo(show: TMDBTVShow): { date: string | null; code: string | null } {
  if (show.next_episode_to_air?.air_date) {
    const ep = show.next_episode_to_air;
    return {
      date: ep.air_date,
      code: `S${String(ep.season_number).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')}`,
    };
  }
  const now = new Date().toISOString().split('T')[0];
  const futureSeason = show.seasons
    ?.filter(s => s.air_date && s.air_date > now && s.season_number > 0)
    .sort((a, b) => a.air_date.localeCompare(b.air_date))[0];
  if (futureSeason?.air_date) {
    return {
      date: futureSeason.air_date,
      code: `S${String(futureSeason.season_number).padStart(2, '0')}E01`,
    };
  }
  return { date: null, code: null };
}

function isWithinDays(dateStr: string | null, days: number): boolean {
  if (!dateStr) return false;
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + days);
  return target >= now && target <= windowEnd;
}

export function useSubscriptionAdvisor(lookAheadDays = 60): AdvisorResult {
  const { getByStatus } = useWatchlist();
  const { user } = useAuth();

  const followingTV = useMemo(
    () => getByStatus('följer', 'tv').filter(i => !i.dropped),
    [getByStatus]
  );

  const tmdbIds = useMemo(() => followingTV.map(i => i.tmdbId), [followingTV]);

  const myProviders = useMemo(() => user?.myProviders ?? [], [user?.myProviders]);
  const providerCosts = useMemo(() => user?.providerCosts ?? {}, [user?.providerCosts]);

  const showQueries = useQueries({
    queries: tmdbIds.map(id => ({
      queryKey: ['tv', id],
      queryFn: () => getTVShow(id),
      staleTime: 10 * 60 * 1000,
      enabled: true,
    })),
  });

  const isLoading = showQueries.some(q => q.isLoading);
  const shows = showQueries
    .map(q => q.data)
    .filter((d): d is TMDBTVShow => d != null);

  return useMemo(() => {
    if (myProviders.length === 0) {
      return { providers: [], subscribeAdvice: [], monthlySavings: 0, totalMonthlyCost: 0, isLoading };
    }

    // Build AdvisedShow for each fetched show
    const advisedShows: AdvisedShow[] = shows.map(show => {
      const seProviders = show['watch/providers']?.results?.SE?.flatrate ?? [];
      const { date, code } = getNextAirInfo(show);
      return {
        tmdbId: show.id,
        title: show.name,
        posterPath: show.poster_path,
        nextAirDate: date,
        nextEpisodeCode: code,
        isEnded: isEnded(show.status),
        providerIds: seProviders.map(p => p.provider_id),
      };
    });

    // Group shows by provider ID
    const showsByProvider = new Map<number, AdvisedShow[]>();
    for (const show of advisedShows) {
      for (const pid of show.providerIds) {
        const list = showsByProvider.get(pid) ?? [];
        list.push(show);
        showsByProvider.set(pid, list);
      }
    }

    // Build advisories for subscribed providers
    const providerAdvisories: ProviderAdvisory[] = [];
    for (const pid of myProviders) {
      const provider = getProvider(pid);
      if (!provider || provider.type !== 'flatrate') continue;

      const providerShows = showsByProvider.get(pid) ?? [];
      const hasActiveShow = providerShows.some(s => isWithinDays(s.nextAirDate, 30));
      const hasUpcomingShow = providerShows.some(s => isWithinDays(s.nextAirDate, lookAheadDays));

      let status: ProviderAdvisory['status'];
      if (hasActiveShow) status = 'active';
      else if (hasUpcomingShow) status = 'upcoming';
      else status = 'pause';

      const dates = providerShows
        .map(s => s.nextAirDate)
        .filter((d): d is string => d != null)
        .sort();

      providerAdvisories.push({
        providerId: pid,
        providerName: provider.name,
        shortName: provider.shortName,
        color: provider.color,
        monthlyCost: providerCosts[pid] ?? null,
        status,
        shows: providerShows,
        nextAirDate: dates[0] ?? null,
      });
    }

    // Sort: active first, then upcoming, then pause
    const statusOrder = { active: 0, upcoming: 1, pause: 2 };
    providerAdvisories.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    // Build subscribe suggestions for non-subscribed providers
    const subscribeAdvice: SubscribeAdvisory[] = [];
    const myProviderSet = new Set(myProviders);
    const nonSubscribedProviders = new Map<number, AdvisedShow[]>();

    for (const show of advisedShows) {
      for (const pid of show.providerIds) {
        if (myProviderSet.has(pid)) continue;
        const provider = getProvider(pid);
        if (!provider || provider.type !== 'flatrate') continue;
        if (!isWithinDays(show.nextAirDate, lookAheadDays)) continue;
        const list = nonSubscribedProviders.get(pid) ?? [];
        list.push(show);
        nonSubscribedProviders.set(pid, list);
      }
    }

    nonSubscribedProviders.forEach((providerShows, pid) => {
      const provider = getProvider(pid)!;
      const dates = providerShows
        .map((s: AdvisedShow) => s.nextAirDate)
        .filter((d: string | null): d is string => d != null)
        .sort();
      subscribeAdvice.push({
        providerId: pid,
        providerName: provider.name,
        shortName: provider.shortName,
        color: provider.color,
        shows: providerShows,
        nearestAirDate: dates[0] ?? null,
      });
    });

    subscribeAdvice.sort((a, b) => {
      if (a.nearestAirDate && b.nearestAirDate) return a.nearestAirDate.localeCompare(b.nearestAirDate);
      if (a.nearestAirDate) return -1;
      return 1;
    });

    const monthlySavings = providerAdvisories
      .filter(p => p.status === 'pause')
      .reduce((sum, p) => sum + (p.monthlyCost ?? 0), 0);

    const totalMonthlyCost = providerAdvisories
      .reduce((sum, p) => sum + (p.monthlyCost ?? 0), 0);

    return { providers: providerAdvisories, subscribeAdvice, monthlySavings, totalMonthlyCost, isLoading };
  }, [shows, myProviders, providerCosts, lookAheadDays, isLoading]);
}
