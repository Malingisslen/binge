'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { getTVShowLite } from '@/lib/tmdb/client';
import { getProvider, canonicalProviderId, canonicalUniqueProviders } from '@/lib/tmdb/providers';
import { resolveEffectiveMonthlyCost } from '@/lib/advisor/effectiveCost';
import { SWEDISH_BUNDLES } from '@/lib/advisor/bundleArbitrage';
import { daysBetween } from '@/lib/utils';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { isEndedStatus } from '@/lib/airingState';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import {
  findTopPausable,
  findCatchupCandidate,
  findIdleNextCheckDate,
  getNextAirInfo,
  isWithinDays,
  isUserBehindOnAired,
  isCaughtUpOnEndedShow,
  aggregateAdvisorLoading,
  splitTvByProgress,
  advisorTmdbIds,
  deriveProviderStatus,
  selectBundleSuggestions,
} from './useSubscriptionAdvisor.helpers';
import type {
  TMDBTVShow, AdvisedShow, ProviderAdvisory, SubscribeAdvisory, AdvisorResult,
  ActivePause, PrimaryAction, WillSeePerProviderRow,
  MostUsedProvider,
} from '@/types';

// Re-export pure helpers so existing imports of these symbols keep working.
export {
  findTopPausable,
  findCatchupCandidate,
  findIdleNextCheckDate,
  getNextAirInfo,
  isWithinDays,
  isUserBehindOnAired,
  CATCHUP_THRESHOLD,
} from './useSubscriptionAdvisor.helpers';

// lookAheadDays = 60: the "upcoming" window matches season-premiere cadence — long
// enough to justify keeping/subscribing, short enough not to nag. The advisor is
// deliberately advisory-only: it never auto-pauses, never auto-subscribes, and never
// projects yearly/lifetime cost totals — it recommends, the user acts.
export function useSubscriptionAdvisor(
  lookAheadDays = 60,
  options?: { enabled?: boolean },
): AdvisorResult {
  const enabled = options?.enabled ?? true;
  const { getByStatus, loading: watchlistLoading } = useWatchlist();
  const { user } = useAuth();

  // 'mina'-TV utan progress (ej påbörjad) behandlas som vill se-ankare —
  // samma roll som TV-vill_se hade före mergen (2026-06). Påbörjade serier
  // är följer-ankare. willSeeItems = vill_se-filmer + ej påbörjade serier.
  const tvInMina = useMemo(
    () => getByStatus('mina', 'tv').filter(i => !i.dropped),
    [getByStatus]
  );
  const { started: followingTV, unstarted: unstartedTV } = useMemo(
    () => splitTvByProgress(tvInMina),
    [tvInMina]
  );
  const willSeeItems = useMemo(
    () => [...getByStatus('vill_se').filter(i => !i.dropped), ...unstartedTV],
    [getByStatus, unstartedTV]
  );

  // We fetch TMDB details for följer TV + vill_se TV (films' watch providers are already on the item's stored providers).
  const tmdbIds = useMemo(
    () => advisorTmdbIds(enabled, followingTV, willSeeItems),
    [enabled, followingTV, willSeeItems]
  );

  const myProviders = useMemo(() => user?.myProviders ?? [], [user?.myProviders]);
  const providerCosts = useMemo(() => user?.providerCosts ?? {}, [user?.providerCosts]);
  const providerTiers = useMemo(() => user?.providerTiers ?? {}, [user?.providerTiers]);
  const providerCampaigns = useMemo(() => user?.providerCampaigns ?? {}, [user?.providerCampaigns]);
  const providerPauses = useMemo(() => user?.providerPauses ?? {}, [user?.providerPauses]);
  // BIN-417: stable per-mount `now` for campaign resolution. Campaigns flip at a
  // day boundary; a per-mount value refreshes on navigation, which is enough and
  // keeps the cost memos stable (never busts on every render).
  const now = useMemo(() => new Date(), []);

  const showQueries = useQueries({
    queries: tmdbIds.map(id => ({
      queryKey: ['tv-lite', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getTVShowLite(id, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
      // Gated mounts pass enabled=false. advisorTmdbIds already returns [] then,
      // so no query is even constructed today — but mirror the flag here so the
      // two guards can't drift and a future change to advisorTmdbIds can't
      // silently re-open the per-library-title fan-out (BIN-290).
      enabled,
    })),
  });

  // A1/X1: isLoading är "allt avgjort?"-flaggan — true tills watchlist-
  // snapshoten landat OCH samtliga TV-detaljqueries avgjorts. Tidigare
  // `some(q => q.isLoading)` var false medan watchlisten laddade (inga
  // queries registrerade än) så konsumenter renderade partiell rådgivning.
  const isLoading = enabled ? aggregateAdvisorLoading(watchlistLoading, showQueries) : false;
  // hasError = minst en fetch misslyckades + det saknas cached data för den.
  // Om en query tidigare lyckats och nu failar använder vi stale data, då
  // betraktar vi inte det som fel mot användaren.
  const hasError = showQueries.some(q => q.isError && !q.data);
  const shows = useMemo(
    () => showQueries.map(q => q.data).filter((d): d is TMDBTVShow => d != null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showQueries.map(q => q.dataUpdatedAt).join(',')]
  );

  const computed = useMemo(() => {
    // Avstängd rådgivare (enabled=false) ELLER inga tjänster konfigurerade →
    // samma tomma, stabila shape. Guarden på !enabled hoppar dessutom över hela
    // beräkningen på bibliotekssidor där rådgivaren är gated (annars körs den
    // per render trots tom fan-out).
    if (!enabled || myProviders.length === 0) {
      return {
        providers: [],
        subscribeAdvice: [],
        willSeeByProvider: [] as WillSeePerProviderRow[],
        monthlySavings: 0,
        totalMonthlyCost: 0,
        primaryAction: { kind: 'idle', nextCheckDate: null } satisfies PrimaryAction,
        secondaryAction: null as Extract<PrimaryAction, { kind: 'catchup' }> | null,
        activePauses: [] as ActivePause[],
        mostUsedProvider: null as MostUsedProvider | null,
        unfinishedTmdbIds: new Set<number>(),
        endedCaughtUpTmdbIds: new Set<number>(),
      };
    }
    // Om alla TMDB-queries failar har vi ingen anchor-data att arbeta med.
    // Returnera tomt så widget kan rendera error-state istället för fantomdata.
    if (hasError && shows.length === 0) {
      return {
        providers: [],
        subscribeAdvice: [],
        willSeeByProvider: [] as WillSeePerProviderRow[],
        monthlySavings: 0,
        totalMonthlyCost: 0,
        primaryAction: { kind: 'idle', nextCheckDate: null } satisfies PrimaryAction,
        secondaryAction: null as Extract<PrimaryAction, { kind: 'catchup' }> | null,
        activePauses: [] as ActivePause[],
        mostUsedProvider: null as MostUsedProvider | null,
        unfinishedTmdbIds: new Set<number>(),
        endedCaughtUpTmdbIds: new Set<number>(),
      };
    }

    const followingIds = new Set(followingTV.map(i => i.tmdbId));
    const willSeeIds = new Set(willSeeItems.filter(i => i.mediaType === 'tv').map(i => i.tmdbId));

    // ads-bucket (AVOD, t.ex. Plex, Pluto, freevee) inkluderas bara om
     // användaren faktiskt prenumererar på någon ads-tjänst — annars rankas
    // icke-relevanta gratis-tjänster upp som "alternativ" vilket förvirrar.
    // Free-bucket (SVT Play, YLE) är alltid relevant eftersom de är licens-
    // finansierade och öppna för alla svenska användare.
    // Canonicalise + dedupe once: a legacy alias+canonical pair (e.g. 531+431)
    // would otherwise build two advisories for the same service and double-count
    // its cost in the total; canonicalising also lets an alias-only saved id
    // match canonical show provider ids (BIN-409).
    const canonMyProviders = canonicalUniqueProviders(myProviders);
    const myProviderSet = new Set(canonMyProviders);
    const userHasAdsProvider = canonMyProviders.some(pid => {
      const p = getProvider(pid);
      return p?.isAds === true;
    });

    const advisedShows: AdvisedShow[] = shows.map(show => {
      const se = show['watch/providers']?.results?.SE;
      const seProviders = [
        ...(se?.flatrate ?? []),
        ...(se?.free ?? []),
        ...(userHasAdsProvider ? (se?.ads ?? []) : []),
      ];
      // Dessutom: om ads-providern råkar vara i användarens uppsättning
      // (men userHasAdsProvider skulle missa det), behåll den anyway.
      if (!userHasAdsProvider) {
        for (const adsP of se?.ads ?? []) {
          if (myProviderSet.has(canonicalProviderId(adsP.provider_id))) {
            seProviders.push(adsP);
          }
        }
      }
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
    for (const pid of canonMyProviders) {
      const provider = getProvider(pid);
      if (!provider || provider.type !== 'flatrate') continue;

      const anchorShows = anchorShowsByProvider.get(pid) ?? [];
      const followingAnchors = anchorShows.filter(s => followingIds.has(s.tmdbId));
      // 30-day "active" window: short enough that the "något på gång just nu"-feeling
      // holds — a provider with content airing inside 30 days is never a pause candidate.
      const hasActiveShow = followingAnchors.some(s => isWithinDays(s.nextAirDate, 30));
      const hasUpcomingShow = followingAnchors.some(s => isWithinDays(s.nextAirDate, lookAheadDays));
      const hasWillSeeAnchor = anchorShows.some(s => !followingIds.has(s.tmdbId));

      // Effektiv månadskostnad = tier/custom/kampanj-kaskaden, inte katalog-
      // defaulten. Delas mellan status-härledningen (BIN-506: en custom-prissatt
      // gratis-katalog-tjänst ska kunna bli paus-kandidat) och monthlyCost nedan.
      const effectiveMonthlyCost = resolveEffectiveMonthlyCost(pid, { providerTiers, providerCosts, providerCampaigns }, now);

      // Status-precedensen bor nu i deriveProviderStatus (BIN-411) — extraherad
      // för egna regressionstester. Named options-fält gör en positionsförväxling
      // omöjlig (hasUpcomingShow/hasWillSeeAnchor är båda boolean → 'upcoming').
      const status = deriveProviderStatus({
        hasActiveShow,
        hasUpcomingShow,
        hasWillSeeAnchor,
        isFree: provider.isFree,
        effectiveMonthlyCost,
      });

      const dates = followingAnchors
        .map(s => s.nextAirDate)
        .filter((d): d is string => d != null)
        .sort();

      providerAdvisories.push({
        providerId: pid,
        providerName: provider.name,
        shortName: provider.shortName,
        color: provider.color,
        monthlyCost: effectiveMonthlyCost,
        status,
        shows: followingAnchors,
        nextAirDate: dates[0] ?? null,
      });
    }

    const statusOrder: Record<ProviderAdvisory['status'], number> = { active: 0, upcoming: 1, free: 2, pause: 3 };
    providerAdvisories.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    const subscribeAdvice: SubscribeAdvisory[] = [];
    // myProviderSet deklareras vid ads-filtrering ovan — återanvänds här.
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
          monthlyCost: resolveEffectiveMonthlyCost(pid, { providerTiers, providerCosts, providerCampaigns }, now),
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
      const monthlyCost = resolveEffectiveMonthlyCost(pid, { providerTiers, providerCosts, providerCampaigns }, now) ?? 0;
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

    // tmdbIds där användaren har osedda aireade avsnitt (= "behind").
    // Använder den råa TMDB-datan via showsByTmdbId — det här är vår enda
    // pålitliga källa; WatchlistItem.lastWatchedSeason ensam kan inte avgöra
    // om användaren är ikapp eller bakom showens senaste aireade avsnitt.
    const showsByTmdbId = new Map<number, TMDBTVShow>(shows.map(s => [s.id, s]));
    const unfinishedTmdbIds = new Set<number>();
    // tmdbIds där användaren är ikapp PÅ en avslutad/inställd serie. Samma
    // redan-hämtade TMDB-data som behind-settet — biblioteket använder det för
    // att flytta avslutade serier till "Avslutade" istället för catch-allen,
    // även när lazy-backfillad tmdbStatus saknas (librarySubState).
    const endedCaughtUpTmdbIds = new Set<number>();
    for (const item of followingTV) {
      const show = showsByTmdbId.get(item.tmdbId);
      if (!show) continue;
      if (isUserBehindOnAired(item, show)) {
        unfinishedTmdbIds.add(item.tmdbId);
      } else if (isCaughtUpOnEndedShow(item, show)) {
        endedCaughtUpTmdbIds.add(item.tmdbId);
      }
    }

    const topPausable = findTopPausable(providerAdvisories, userPausedSet);
    const catchup = findCatchupCandidate(providerAdvisories, unfinishedTmdbIds, userPausedSet);
    const topSubscribe = subscribeAdvice[0];

    const pauseAction: Extract<PrimaryAction, { kind: 'pause' }> | null = topPausable ? {
      kind: 'pause',
      providerId: topPausable.providerId,
      providerName: topPausable.providerName,
      shortName: topPausable.shortName,
      color: topPausable.color,
      monthlyCost: topPausable.monthlyCost ?? 0,
      nextAirDate: topPausable.nextAirDate,
    } : null;

    const catchupAction: Extract<PrimaryAction, { kind: 'catchup' }> | null = catchup ? {
      kind: 'catchup',
      providerId: catchup.provider.providerId,
      providerName: catchup.provider.providerName,
      shortName: catchup.provider.shortName,
      color: catchup.provider.color,
      unfinishedCount: catchup.unfinishedCount,
      monthlyCost: catchup.provider.monthlyCost ?? 0,
    } : null;

    const subscribeAction: Extract<PrimaryAction, { kind: 'subscribe' }> | null = topSubscribe ? {
      kind: 'subscribe',
      providerId: topSubscribe.providerId,
      providerName: topSubscribe.providerName,
      shortName: topSubscribe.shortName,
      color: topSubscribe.color,
      showCount: topSubscribe.shows.length,
      nearestAirDate: topSubscribe.nearestAirDate,
      // Route through the shared resolver even here (a not-yet-subscribed provider
      // normally has no tier/custom entry, so this equals defaultMonthlyCost today)
      // — keeps the "one source of truth" invariant airtight against a stale
      // providerTiers/providerCosts entry left behind after un-subscribing.
      monthlyCost: resolveEffectiveMonthlyCost(topSubscribe.providerId, { providerTiers, providerCosts, providerCampaigns }, now) ?? 0,
    } : null;

    const primaryAction: PrimaryAction =
      pauseAction
      ?? catchupAction
      ?? subscribeAction
      ?? { kind: 'idle', nextCheckDate: findIdleNextCheckDate(providerAdvisories, activePauses) };

    // När primary är pause, men det också finns en catchup-kandidat, visa
    // catchup som sekundär — annars skuggas catchup-rådet av besparingen.
    const secondaryAction = primaryAction.kind === 'pause' ? catchupAction : null;

    // Räknas Följer och Vill se separat så kortet kan visa "X följer · Y vill se".
    const mostUsedProvider: MostUsedProvider | null = (() => {
      const counts = new Map<number, { follow: number; willSee: number }>();
      for (const show of allAnchors) {
        const isFollow = followingIds.has(show.tmdbId);
        for (const pid of show.providerIds) {
          if (!myProviderSet.has(pid)) continue;
          const e = counts.get(pid) ?? { follow: 0, willSee: 0 };
          if (isFollow) e.follow++;
          else e.willSee++;
          counts.set(pid, e);
        }
      }
      const ranked = Array.from(counts.entries())
        .map(([pid, c]) => ({ pid, follow: c.follow, willSee: c.willSee, total: c.follow + c.willSee }))
        .sort((a, b) => b.total - a.total);
      const top = ranked[0];
      if (!top) return null;
      const provider = getProvider(top.pid);
      if (!provider) return null;
      return {
        providerId: top.pid,
        providerName: provider.name,
        shortName: provider.shortName,
        color: provider.color,
        followCount: top.follow,
        willSeeCount: top.willSee,
      };
    })();

    return {
      providers: providerAdvisories,
      subscribeAdvice,
      willSeeByProvider,
      monthlySavings,
      totalMonthlyCost,
      primaryAction,
      secondaryAction,
      activePauses,
      mostUsedProvider,
      unfinishedTmdbIds,
      endedCaughtUpTmdbIds,
    };
  }, [enabled, shows, followingTV, willSeeItems, myProviders, providerCosts, providerTiers, providerCampaigns, now, providerPauses, lookAheadDays, hasError]);

  // BIN-430: paket-arbitrage. Ren funktion över ägda tjänster + samma
  // campaign-cost-inställningar (providerTiers/providerCosts/providerCampaigns)
  // + samma per-mount `now` som resten av kostnadskaskaden. Ingen TMDB-fan-out,
  // så den beräknas fristående från `computed` och överlever ett TMDB-fel.
  // enabled=false (gated bibliotekssidor) → tom, precis som computed.
  const bundleSuggestions = useMemo(
    () =>
      selectBundleSuggestions(
        enabled,
        myProviders,
        { providerTiers, providerCosts, providerCampaigns },
        SWEDISH_BUNDLES,
        now,
      ),
    [enabled, myProviders, providerTiers, providerCosts, providerCampaigns, now],
  );

  // BIN-448: expose whether the user has ANY configured service, independent of
  // the derived `providers` array (which the TMDB fan-out zeroes on a fetch
  // error). The savings page uses this to keep the honest outage state gated to
  // real subscribers and fall through to "inga tjänster tillagda" otherwise.
  const hasConfiguredProviders = myProviders.length > 0;

  return { ...computed, bundleSuggestions, isLoading, hasError, hasConfiguredProviders };
}
