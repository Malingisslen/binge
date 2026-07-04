'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { getMovieLite, getTVShowLite } from '@/lib/tmdb/client';
import { canonicalUniqueProviders } from '@/lib/tmdb/providers';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { cheapestListPlan, type ListPlan, type ListTitle } from '@/lib/advisor/listOptimizer';
import { toListTitle, type LiteDetailLike } from '@/lib/advisor/listPlanInput';

export interface ListPlanItem {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
}

export interface UseListCheapestPlanResult {
  plan: ListPlan | null;
  isLoading: boolean;
  /** Every title failed to fetch (no cached data) — no plan can be built. */
  hasError: boolean;
  /** Titles that errored with no cached data — disclosed separately from
   *  "unavailable in Sweden" so an error is never counted as a real negative. */
  uncheckableCount: number;
}

/**
 * BIN-416 — fan out the lite TMDB detail per list title, feed the pure
 * `cheapestListPlan` optimizer, and return an honest plan for the list surface.
 *
 * Cost discipline (CLAUDE.md): uses the LITE fetchers (getMovieLite/getTVShowLite)
 * on this per-title fan-out — never full-detail — and shares the SAME
 * `['{movie,tv}-lite', id]` queryKey + `TMDB_STALE.LITE_DETAIL` staleTime as
 * useSubscriptionAdvisor / useCalendar so the observers don't fight over cache.
 * Per-title lite data is intentionally NOT React-Query-persisted (it scales with
 * list size); re-fetches are cheap and gated.
 *
 * Honesty gate (role #28 must-haves): the plan is computed ZERO times while any
 * title is still loading — a pending title would otherwise be miscounted as
 * "unavailable in Sweden". A title that errors with no cached data is EXCLUDED
 * from the optimizer input (not defaulted to unavailable) and surfaced via
 * uncheckableCount instead. ownedProviderIds is canonicalised at this call site.
 */
export function useListCheapestPlan(
  items: ListPlanItem[],
  options?: { enabled?: boolean },
): UseListCheapestPlanResult {
  const enabled = options?.enabled ?? true;
  const { user } = useAuth();
  // BIN-417: stable per-mount `now` for campaign resolution (see useSubscriptionAdvisor).
  const now = useMemo(() => new Date(), []);

  const queries = useQueries({
    queries: items.map((item) => ({
      queryKey: [item.mediaType === 'movie' ? 'movie-lite' : 'tv-lite', item.tmdbId],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        item.mediaType === 'movie'
          ? getMovieLite(item.tmdbId, { signal })
          : getTVShowLite(item.tmdbId, { signal }),
      staleTime: TMDB_STALE.LITE_DETAIL,
      enabled,
    })),
  });

  // isLoading only while a title has NO data yet and is fetching first-time
  // (RQ v5 isLoading = isPending && isFetching). A cached title refetching in the
  // background does NOT blank the panel. Once every title has settled to data OR
  // a terminal error, this is false.
  const isLoading = enabled && items.length > 0 && queries.some((q) => q.isLoading);

  // Stable dependency key: recompute only when a title's data/error timestamp moves.
  const settleKey = queries.map((q) => `${q.dataUpdatedAt}:${q.errorUpdatedAt}`).join(',');

  return useMemo<UseListCheapestPlanResult>(() => {
    if (!enabled || isLoading || items.length === 0) {
      return { plan: null, isLoading, hasError: false, uncheckableCount: 0 };
    }

    const titles: ListTitle[] = [];
    let uncheckableCount = 0;
    queries.forEach((q, i) => {
      if (q.data) {
        titles.push(toListTitle(items[i], q.data as LiteDetailLike));
      } else {
        // Errored with no cached data → do NOT default to {unavailable}; disclose.
        uncheckableCount += 1;
      }
    });

    const ownedProviderIds = canonicalUniqueProviders(user?.myProviders ?? []);
    const plan =
      titles.length > 0
        ? cheapestListPlan(
            titles,
            {
              providerTiers: user?.providerTiers ?? {},
              providerCosts: user?.providerCosts ?? {},
              providerCampaigns: user?.providerCampaigns ?? {}, // BIN-417 campaign-aware
              ownedProviderIds,
            },
            now,
          )
        : null;

    return {
      plan,
      isLoading: false,
      hasError: uncheckableCount === items.length,
      uncheckableCount,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isLoading, items, settleKey, user?.myProviders, user?.providerTiers, user?.providerCosts, user?.providerCampaigns, now]);
}
