'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { getTVShow } from '@/lib/tmdb/client';
import { getProvider, canonicalProviderId } from '@/lib/tmdb/providers';
import { formatEpisodeCode, daysBetween, todayIso } from '@/lib/utils';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { isEndedStatus } from '@/lib/airingState';
import type {
  TMDBTVShow, AdvisedShow, ProviderAdvisory, SubscribeAdvisory, AdvisorResult,
  ActivePause, PrimaryAction, WatchlistItem, WillSeePerProviderRow,
} from '@/types';

function findTopPausable(
  providers: ProviderAdvisory[],
  userPausedSet: Set<number>,
): ProviderAdvisory | undefined {
  return providers
    .filter(p => p.status === 'pause' && !userPausedSet.has(p.providerId) && (p.monthlyCost ?? 0) > 0)
    .sort((a, b) => (b.monthlyCost ?? 0) - (a.monthlyCost ?? 0))[0];
}

// Threshold 3 = "påbörjat flera serier" — undviker att tjata om enstaka påbörjade titlar.
const CATCHUP_THRESHOLD = 3;

function findCatchupCandidate(
  providers: ProviderAdvisory[],
  followingById: Map<number, WatchlistItem>,
): { provider: ProviderAdvisory; unfinishedCount: number } | undefined {
  return providers
    .filter(p => p.status === 'active')
    .map(p => ({
      provider: p,
      unfinishedCount: p.shows
        .map(s => followingById.get(s.tmdbId))
        .filter((wi): wi is WatchlistItem => !!wi && !!wi.lastWatchedSeason)
        .length,
    }))
    .filter(x => x.unfinishedCount >= CATCHUP_THRESHOLD)
    .sort((a, b) => b.unfinishedCount - a.unfinishedCount)[0];
}

function findIdleNextCheckDate(
  providers: ProviderAdvisory[],
  activePauses: ActivePause[],
): string | null {
  const candidates: string[] = [];
  for (const p of providers) if (p.nextAirDate) candidates.push(p.nextAirDate);
  for (const ap of activePauses) if (ap.resumeAt) candidates.push(ap.resumeAt);
  candidates.sort();
  return candidates[0] ?? null;
}

function getNextAirInfo(show: TMDBTVShow): { date: string | null; code: string | null } {
  if (show.next_episode_to_air?.air_date) {
    const ep = show.next_episode_to_air;
    return {
      date: ep.air_date,
      code: formatEpisodeCode(ep.season_number, ep.episode_number),
    };
  }
  const now = todayIso();
  const futureSeason = show.seasons
    ?.filter(s => s.air_date && s.air_date > now && s.season_number > 0)
    .sort((a, b) => a.air_date.localeCompare(b.air_date))[0];
  if (futureSeason?.air_date) {
    return {
      date: futureSeason.air_date,
      code: formatEpisodeCode(futureSeason.season_number, 1),
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
  const willSeeItems = useMemo(
    () => getByStatus('vill_se').filter(i => !i.dropped),
    [getByStatus]
  );

  // We fetch TMDB details for följer TV + vill_se TV (films' watch providers are already on the item's stored providers).
  const tmdbIds = useMemo(
    () => Array.from(new Set([
      ...followingTV.map(i => i.tmdbId),
      ...willSeeItems.filter(i => i.mediaType === 'tv').map(i => i.tmdbId),
    ])),
    [followingTV, willSeeItems]
  );

  const myProviders = useMemo(() => user?.myProviders ?? [], [user?.myProviders]);
  const providerCosts = useMemo(() => user?.providerCosts ?? {}, [user?.providerCosts]);
  const providerPauses = useMemo(() => user?.providerPauses ?? {}, [user?.providerPauses]);

  const showQueries = useQueries({
    queries: tmdbIds.map(id => ({
      queryKey: ['tv', id],
      queryFn: () => getTVShow(id),
      staleTime: 10 * 60 * 1000,
      enabled: true,
    })),
  });

  const isLoading = showQueries.some(q => q.isLoading);
  const shows = useMemo(
    () => showQueries.map(q => q.data).filter((d): d is TMDBTVShow => d != null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showQueries.map(q => q.dataUpdatedAt).join(',')]
  );

  const computed = useMemo(() => {
    if (myProviders.length === 0) {
      return {
        providers: [],
        subscribeAdvice: [],
        willSeeByProvider: [] as WillSeePerProviderRow[],
        monthlySavings: 0,
        totalMonthlyCost: 0,
        primaryAction: { kind: 'idle', nextCheckDate: null } satisfies PrimaryAction,
        activePauses: [] as ActivePause[],
      };
    }

    const followingIds = new Set(followingTV.map(i => i.tmdbId));
    const willSeeIds = new Set(willSeeItems.filter(i => i.mediaType === 'tv').map(i => i.tmdbId));

    const followingById = new Map<number, WatchlistItem>(followingTV.map(i => [i.tmdbId, i]));

    const advisedShows: AdvisedShow[] = shows.map(show => {
      const se = show['watch/providers']?.results?.SE;
      const seProviders = [
        ...(se?.flatrate ?? []),
        ...(se?.free ?? []),
        ...(se?.ads ?? []),
      ];
      const { date, code } = getNextAirInfo(show);
      return {
        tmdbId: show.id,
        mediaType: 'tv',
        title: preferOriginalTitle(show.name, show.original_name),
        posterPath: show.poster_path,
        nextAirDate: date,
        nextEpisodeCode: code,
        isEnded: isEndedStatus(show.status),
        releaseDate: show.first_air_date ?? null,
        providerIds: Array.from(new Set(seProviders.map(p => canonicalProviderId(p.provider_id)))),
      };
    });

    const followingAdvised = advisedShows.filter(s => followingIds.has(s.tmdbId));
    const willSeeAdvised = advisedShows.filter(s => willSeeIds.has(s.tmdbId));

    const willSeeFilmAdvised: AdvisedShow[] = willSeeItems
      .filter(i => i.mediaType === 'movie')
      .map(film => ({
        tmdbId: film.tmdbId,
        mediaType: 'movie',
        title: film.title,
        posterPath: film.posterPath,
        nextAirDate: null,
        nextEpisodeCode: null,
        isEnded: false,
        releaseDate: film.releaseYear ? `${film.releaseYear}-01-01` : null,
        providerIds: film.providers,
      }));

    const allAnchors = [...followingAdvised, ...willSeeAdvised, ...willSeeFilmAdvised];
    const anchorShowsByProvider = new Map<number, AdvisedShow[]>();
    for (const show of allAnchors) {
      for (const pid of show.providerIds) {
        const list = anchorShowsByProvider.get(pid) ?? [];
        list.push(show);
        anchorShowsByProvider.set(pid, list);
      }
    }

    const providerAdvisories: ProviderAdvisory[] = [];
    for (const pid of myProviders) {
      const provider = getProvider(pid);
      if (!provider || provider.type !== 'flatrate') continue;

      const anchorShows = anchorShowsByProvider.get(pid) ?? [];
      const followingAnchors = anchorShows.filter(s => followingIds.has(s.tmdbId));
      const hasActiveShow = followingAnchors.some(s => isWithinDays(s.nextAirDate, 30));
      const hasUpcomingShow = followingAnchors.some(s => isWithinDays(s.nextAirDate, lookAheadDays));
      const hasWillSeeAnchor = anchorShows.some(s => !followingIds.has(s.tmdbId));

      let status: ProviderAdvisory['status'];
      if (hasActiveShow) status = 'active';
      else if (hasUpcomingShow) status = 'upcoming';
      else if (hasWillSeeAnchor) status = 'upcoming';
      else if (provider.isFree) status = 'free';
      else status = 'pause';

      const dates = followingAnchors
        .map(s => s.nextAirDate)
        .filter((d): d is string => d != null)
        .sort();

      providerAdvisories.push({
        providerId: pid,
        providerName: provider.name,
        shortName: provider.shortName,
        color: provider.color,
        monthlyCost: providerCosts[pid] ?? provider.defaultMonthlyCost ?? null,
        status,
        shows: followingAnchors,
        nextAirDate: dates[0] ?? null,
      });
    }

    const statusOrder: Record<ProviderAdvisory['status'], number> = { active: 0, upcoming: 1, free: 2, pause: 3 };
    providerAdvisories.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    const subscribeAdvice: SubscribeAdvisory[] = [];
    const myProviderSet = new Set(myProviders);
    const nonSubscribedProviders = new Map<number, AdvisedShow[]>();

    for (const show of allAnchors) {
      const hasOnMyProvider = show.providerIds.some(pid => myProviderSet.has(pid));
      if (hasOnMyProvider) continue;
      const isFollowing = followingIds.has(show.tmdbId);
      // Only apply the air-date window to Följer — vill_se titles are available now.
      if (isFollowing && !isWithinDays(show.nextAirDate, lookAheadDays)) continue;
      for (const pid of show.providerIds) {
        const provider = getProvider(pid);
        if (!provider || provider.type !== 'flatrate') continue;
        const list = nonSubscribedProviders.get(pid) ?? [];
        list.push(show);
        nonSubscribedProviders.set(pid, list);
      }
    }

    nonSubscribedProviders.forEach((providerShows, pid) => {
      const provider = getProvider(pid)!;
      const dates = providerShows
        .map(s => s.nextAirDate)
        .filter((d): d is string => d != null)
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

    const willSeeByProvider: WillSeePerProviderRow[] = (() => {
      const counts = new Map<number, { tv: number; movie: number }>();
      for (const show of [...willSeeAdvised, ...willSeeFilmAdvised]) {
        for (const pid of show.providerIds) {
          const entry = counts.get(pid) ?? { tv: 0, movie: 0 };
          if (show.mediaType === 'movie') entry.movie++;
          else entry.tv++;
          counts.set(pid, entry);
        }
      }
      const rows: WillSeePerProviderRow[] = [];
      counts.forEach((c, pid) => {
        const provider = getProvider(pid);
        if (!provider || provider.type !== 'flatrate') return;
        rows.push({
          providerId: pid,
          providerName: provider.name,
          shortName: provider.shortName,
          color: provider.color,
          isSubscribed: myProviderSet.has(pid),
          monthlyCost: providerCosts[pid] ?? provider.defaultMonthlyCost ?? null,
          tvCount: c.tv,
          movieCount: c.movie,
        });
      });
      rows.sort((a, b) => {
        if (a.isSubscribed !== b.isSubscribed) return a.isSubscribed ? -1 : 1;
        return (b.tvCount + b.movieCount) - (a.tvCount + a.movieCount);
      });
      return rows;
    })();

    // Active user-initiated pauses (state from profile)
    const activePauses: ActivePause[] = [];
    for (const pidStr of Object.keys(providerPauses)) {
      const pid = Number(pidStr);
      const provider = getProvider(pid);
      if (!provider) continue;
      const state = providerPauses[pid];
      const monthlyCost = providerCosts[pid] ?? provider.defaultMonthlyCost ?? 0;
      const days = daysBetween(state.pausedAt);
      activePauses.push({
        providerId: pid,
        providerName: provider.name,
        shortName: provider.shortName,
        color: provider.color,
        pausedAt: state.pausedAt,
        resumeAt: state.resumeAt,
        monthlyCost,
        savingsSoFar: Math.round((monthlyCost * days) / 30),
      });
    }

    // Monthly savings = sum of costs for providers we've paused OR advisor suggests pause (not yet paused)
    const userPausedSet = new Set(activePauses.map(p => p.providerId));
    const monthlySavings = providerAdvisories
      .filter(p => p.status === 'pause' && !userPausedSet.has(p.providerId))
      .reduce((sum, p) => sum + (p.monthlyCost ?? 0), 0);

    const totalMonthlyCost = providerAdvisories
      .filter(p => !userPausedSet.has(p.providerId))
      .reduce((sum, p) => sum + (p.monthlyCost ?? 0), 0);

    const primaryAction: PrimaryAction = (() => {
      const topPausable = findTopPausable(providerAdvisories, userPausedSet);
      if (topPausable) {
        return {
          kind: 'pause',
          providerId: topPausable.providerId,
          providerName: topPausable.providerName,
          shortName: topPausable.shortName,
          color: topPausable.color,
          monthlyCost: topPausable.monthlyCost ?? 0,
          nextAirDate: topPausable.nextAirDate,
        };
      }

      const catchup = findCatchupCandidate(providerAdvisories, followingById);
      if (catchup) {
        return {
          kind: 'catchup',
          providerId: catchup.provider.providerId,
          providerName: catchup.provider.providerName,
          shortName: catchup.provider.shortName,
          color: catchup.provider.color,
          unfinishedCount: catchup.unfinishedCount,
          monthlyCost: catchup.provider.monthlyCost ?? 0,
        };
      }

      const topSubscribe = subscribeAdvice[0];
      if (topSubscribe) {
        return {
          kind: 'subscribe',
          providerId: topSubscribe.providerId,
          providerName: topSubscribe.providerName,
          shortName: topSubscribe.shortName,
          color: topSubscribe.color,
          showCount: topSubscribe.shows.length,
          nearestAirDate: topSubscribe.nearestAirDate,
          monthlyCost: getProvider(topSubscribe.providerId)?.defaultMonthlyCost ?? 0,
        };
      }

      return { kind: 'idle', nextCheckDate: findIdleNextCheckDate(providerAdvisories, activePauses) };
    })();

    return {
      providers: providerAdvisories,
      subscribeAdvice,
      willSeeByProvider,
      monthlySavings,
      totalMonthlyCost,
      primaryAction,
      activePauses,
    };
  }, [shows, followingTV, willSeeItems, myProviders, providerCosts, providerPauses, lookAheadDays]);

  return { ...computed, isLoading };
}
