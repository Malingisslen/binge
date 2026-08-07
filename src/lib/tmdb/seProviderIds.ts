import { canonicalProviderId } from '@/lib/tmdb/providers';

/**
 * The SE `watch/providers` block as the title-page refresh needs to read it.
 * Structural, not `TMDBMovie | TMDBTVShow`: both detail types satisfy it, and the
 * helper has no business knowing which one it was handed.
 */
export interface SEWatchProvidersDetail {
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
 * BIN-468 item 3 — the provider derivation the movie and TV detail pages both feed
 * to `refreshTmdbFields`, in ONE place. It used to be copy-pasted into both page
 * effects, which meant the two subtleties below could be fixed on one page and
 * silently left broken on the other.
 *
 * The two subtleties, both load-bearing:
 *
 *  1. **Absent SE block → `undefined`, never `[]`.** `undefined` means "this render
 *     learned nothing about Swedish availability", and `planTmdbFieldsRefresh`
 *     skips the providers group entirely for it — so a detail fetch that came back
 *     without a SE block cannot blank a good denormalized array. An EMPTY-but-
 *     present SE block is the opposite: a real TMDB answer of "nowhere in Sweden",
 *     and it correctly writes `[]`.
 *  2. **rent + buy are included.** The denormalized `providers` array answers "where
 *     can this be watched at all", which the sweep re-checks and the advisor reads.
 *
 * NOT the same function as `extractSEProviders` in `./providers`, and they must not
 * be merged. That one keeps subscription-ish tiers only (flatrate/free/ads) and
 * returns `[]` for an absent block — exactly the clobbering value this one must
 * never produce.
 *
 * Be precise about why they differ, because it is NOT "different fields": taste
 * backfill (`src/lib/taste/backfill.ts`) writes its narrower result to the SAME
 * `watchlist.providers` and stamps the SAME `providersCheckedAt`, on a matching
 * 60-day window. So the field has two writers with two definitions of "providers",
 * and its content depends on which ran last — a rentable title can be a will-see
 * anchor for a subscription after a title-page view and stop being one after the
 * next backfill. Which definition should win is an open question (see BIN-814);
 * merging these two helpers would settle it silently and in the wrong direction.
 */
export function seProviderIdsForRefresh(detail: SEWatchProvidersDetail): number[] | undefined {
  const se = detail['watch/providers']?.results?.SE;
  if (!se) return undefined;
  return Array.from(new Set(
    [...(se.flatrate ?? []), ...(se.free ?? []), ...(se.ads ?? []), ...(se.rent ?? []), ...(se.buy ?? [])]
      .map(p => canonicalProviderId(p.provider_id)),
  ));
}
