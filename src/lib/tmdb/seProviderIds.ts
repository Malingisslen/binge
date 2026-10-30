import { canonicalProviderId } from '@/lib/tmdb/providers';

const SVT_PLAY_ID = 520;
const SVT_NETWORK = /^SVT(\d+|\s|$)/i;

/**
 * The SE `watch/providers` block as the watchlist denormalization needs to read it.
 * Structural, not `TMDBMovie | TMDBTVShow`: both detail types satisfy it, and the
 * helpers have no business knowing which one they were handed.
 */
export interface SEWatchProvidersDetail {
  // TV details only. Movies never carry it, so the SVT inference below never fires for them.
  networks?: { name: string }[];
  status?: string;
  'watch/providers'?: {
    results?: {
      SE?: {
        flatrate?: { provider_id: number }[];
        free?: { provider_id: number }[];
        ads?: { provider_id: number }[];
        rent?: { provider_id: number }[];
        buy?: { provider_id: number }[];
      };
    };
  };
}

/**
 * BIN-814 — the watchlist stores TWO provider answers, because the app asks two
 * different questions and they have different answers for the same title.
 *
 *  • `providers` (below, `seProviderIdsForRefresh`) — "where can I watch this AT ALL",
 *    including rent and buy. Drives the provider icons on a library card.
 *  • `subscriptionProviders` (`seSubscriptionProviderIdsForRefresh`) — "which of my
 *    SUBSCRIPTIONS covers this", flatrate/free/ads only. Drives the advisor's
 *    keep-or-pause reasoning.
 *
 * Until 2026-08-09 there was one field and two writers with two definitions — the
 * title page wrote the broad set, taste-backfill wrote the narrow one, and the stored
 * value depended on which ran last (BIN-814). Collapsing to ONE definition cannot
 * work, and not for the reason it looks like: the advisor already filters anchors to
 * `type === 'flatrate'` providers, but the SE catalogue returns `76 Viaplay` and
 * `489/1944 TV4 Play` under `rent`/`buy` as well, and both are typed flatrate in
 * SWEDISH_PROVIDERS. Verified against live TMDB SE data 2026-08-09 on four titles.
 * A flat `number[]` therefore cannot tell "included in the subscription" from
 * "rentable there", so a broad-only field makes a rentable film argue against
 * pausing a subscription you would still have to pay extra to use.
 *
 * (Amazon is NOT such a case and does not need special handling: TMDB SE splits
 * `119 Amazon Prime Video` (flatrate) from `10 Amazon Video` (rent/buy).)
 *
 * Both helpers share ONE contract, and it is load-bearing in both:
 *
 *  1. **Absent SE block → `undefined`, never `[]`.** `undefined` means "this fetch
 *     learned nothing about Swedish availability", and every caller skips the field
 *     for it — so a detail fetch that came back without a SE block cannot blank a
 *     good denormalized array. An EMPTY-but-present SE block is the opposite: a real
 *     TMDB answer of "nowhere in Sweden", and it correctly writes `[]`.
 *  2. **Same input, same canonicalization, one pass.** Every writer derives BOTH from
 *     the same detail object and writes them together — the title-page refresh, the
 *     taste backfill, and the add path (`buildAddPayload` carries the pair). That is
 *     an invariant to preserve, not a property the types enforce: a writer that sent
 *     only the broad field would also stamp `providersCheckedAt`, which gates the
 *     title-page repair out for 60 days, so the advisor would keep reading the
 *     fallback on exactly the titles this split exists for.
 */
/**
 * TMDB's watch data (JustWatch) usually has no SVT Play entry for SVT's own programmes, so a
 * running SVT show reads as "nowhere in Sweden" although it is free on svtplay.se. An SVT
 * network on a show that is still running is the evidence we trust instead. Ended shows are
 * excluded because SVT Play drops old programmes and we cannot see which ones are gone.
 */
function isRunningSvtShow(detail: SEWatchProvidersDetail): boolean {
  return detail.status === 'Returning Series'
    && (detail.networks ?? []).some(n => SVT_NETWORK.test(n.name));
}

function seCategoryIds(
  detail: SEWatchProvidersDetail,
  categories: ('flatrate' | 'free' | 'ads' | 'rent' | 'buy')[],
): number[] | undefined {
  const se = detail['watch/providers']?.results?.SE;
  const ids = se
    ? Array.from(new Set(categories.flatMap(c => se[c] ?? []).map(p => canonicalProviderId(p.provider_id))))
    : undefined;
  if (!categories.includes('free') || !isRunningSvtShow(detail)) return ids;
  const withSvt = ids ?? [];
  return withSvt.includes(SVT_PLAY_ID) ? withSvt : [...withSvt, SVT_PLAY_ID];
}

/** "Where can this be watched at all" — includes rent and buy. Feeds `providers`. */
export function seProviderIdsForRefresh(detail: SEWatchProvidersDetail): number[] | undefined {
  return seCategoryIds(detail, ['flatrate', 'free', 'ads', 'rent', 'buy']);
}

/**
 * "Which subscription-ish services carry this" — flatrate/free/ads, no rent or buy.
 * Feeds `subscriptionProviders`, which is the ONLY provider field the advisor's
 * keep-or-pause reasoning may read: a title you could rent on a service is not a
 * reason to keep paying for that service.
 */
export function seSubscriptionProviderIdsForRefresh(detail: SEWatchProvidersDetail): number[] | undefined {
  return seCategoryIds(detail, ['flatrate', 'free', 'ads']);
}
