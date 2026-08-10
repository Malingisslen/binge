import type { WatchlistItem } from '@/types';

/**
 * BIN-814. Which provider ids a stored watchlist row may contribute to a
 * MONEY question — "is this service earning its subscription fee": the advisor's
 * keep-or-pause verdict, the savings page's active-vs-idle split, the household
 * dead-weight verdict, and the per-service value card.
 *
 * The distinction is not cosmetic. `providers` answers "where can this be watched
 * at all" and includes rent and buy; the SE catalogue returns `76 Viaplay` and
 * `489 TV4 Play` under `rent`/`buy` while both are typed `flatrate` in
 * SWEDISH_PROVIDERS (verified against live TMDB SE data 2026-08-09), so a
 * provider-type filter cannot recover the difference after the fact. Reading the
 * broad array on a money surface means a film you would still have to pay extra to
 * watch argues that the subscription is being used.
 *
 * Lives in `lib/` rather than beside the advisor hook because four unrelated
 * surfaces need the same rule, and a shared rule that lives inside one consumer is
 * how the two definitions drifted apart in the first place.
 *
 * The fallback covers rows written before the split (`subscriptionProviders` null).
 * Keeping today's over-generous answer beats losing the signal outright, which would
 * advise pausing a service the user demonstrably has something waiting on. Note the
 * three-way distinction this preserves: `null` = never backfilled, `[]` = checked and
 * no subscription covers it (a real answer, and a real reason to consider pausing).
 *
 * How a null row stops being null, stated carefully because the obvious version is
 * backwards: a title-page visit does NOT always write the field. The whole providers
 * group is gated on `providersCheckedAt` (see `tmdbFieldsRefresh`), so a row whose
 * 60-day window is still fresh keeps the fallback until that window lapses — and the
 * rows carrying a fresh stamp are precisely the actively-used ones. What lands
 * immediately is a re-mark or a new add through a title page or a card, because those
 * write the pair directly. The taste backfill fills the rest, but it is a manual
 * button in settings and skips fresh rows for the same reason.
 *
 * So the honest summary is: every row converges, none of them instantly, and the
 * fallback is what keeps the answer sane in the meantime.
 */
export function subscriptionProviderIds(
  item: Pick<WatchlistItem, 'providers' | 'subscriptionProviders'>,
): number[] {
  return item.subscriptionProviders ?? item.providers ?? [];
}
