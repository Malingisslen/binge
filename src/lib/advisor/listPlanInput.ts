// BIN-416 — adapt a list item + its TMDB lite detail into the pure optimizer's
// ListTitle input. Extracted from the fan-out hook so the SE-provider extraction
// is unit-testable without React Query / Firebase (same extract-pure-logic split
// as useSubscriptionAdvisor.helpers).
//
// Honesty contract (role #28 must-haves, BIN-416):
//   1. subscriptionProviderIds is a THIN passthrough of TMDB's RAW SE flatrate +
//      free provider_ids — no canonicalisation, no catalogue filtering here. The
//      optimizer's own subsOf() owns both (canonicalProviderId + drop-uncatalogued
//      is the guard against an unknown SE id resolving to a phantom 0-kr "free
//      win"). Duplicating that logic here would risk drift; keep it mechanical.
//   2. ads is NEVER included. The personal advisor conditionally credits an ads
//      provider only when it knows THIS user subscribes to one; a curated list has
//      no per-viewer ads context, so crediting Pluto TV et al. here would fabricate
//      a "free" coverage win. Subscription = flatrate + free only.
//   3. rentable is computed INDEPENDENTLY of the subscription list — a title with
//      no subscription but a SE rent/buy offer is a rent candidate, not
//      "unavailable". (A title that hasn't loaded yet must never reach this
//      mapper — the hook excludes it — so an empty result here always means a
//      genuinely uncovered title, never a pending fetch.)

import type { ListTitle } from '@/lib/advisor/listOptimizer';

interface SEOffers {
  flatrate?: { provider_id: number }[];
  free?: { provider_id: number }[];
  ads?: { provider_id: number }[];
  rent?: { provider_id: number }[];
  buy?: { provider_id: number }[];
}

/** Structural shape shared by TMDBMovie and TMDBTVShow lite details. */
export interface LiteDetailLike {
  'watch/providers'?: { results?: { SE?: SEOffers } };
}

export function toListTitle(
  item: { tmdbId: number; title: string },
  detail: LiteDetailLike,
): ListTitle {
  const se = detail['watch/providers']?.results?.SE;
  // Raw ids, flatrate + free only (NO ads, NO canonicalise) — see contract above.
  const subscriptionProviderIds = [
    ...(se?.flatrate ?? []),
    ...(se?.free ?? []),
  ].map((p) => p.provider_id);
  // Independent of the subscription list: a SE rent OR buy offer makes it rentable.
  const rentable = ((se?.rent?.length ?? 0) + (se?.buy?.length ?? 0)) > 0;
  return { tmdbId: item.tmdbId, title: item.title, subscriptionProviderIds, rentable };
}
