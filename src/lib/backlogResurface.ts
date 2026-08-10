import { subscriptionProviderIds } from '@/lib/watchlist/subscriptionProviders';
import type { WatchlistItem } from '@/types';

// BIN-88 — "ville se — finns nu på din tjänst". Watchlists go stale; this
// resurfaces the most-forgotten vill_se titles that are INCLUDED in a service the
// user already pays for — not merely obtainable there; see the filter below. Pure:
// addedAt/providers/myProviders are all already denormalized on the watchlist doc,
// so no TMDB calls. (vill_se is film-only in
// the current status model — TV lives under 'mina'.)

function addedMs(item: WatchlistItem): number {
  return item.addedAt instanceof Date ? item.addedAt.getTime() : 0;
}

/**
 * Up to `limit` vill_se items whose denormalized `subscriptionProviders` intersect
 * `myProviders` (falling back to `providers` for rows written before BIN-814 split
 * the two), oldest `addedAt` first (most "forgotten"). Empty when the user has no
 * services selected (nothing to match against).
 */
export function pickBacklogResurface(
  items: WatchlistItem[],
  myProviders: number[],
  limit = 3,
): WatchlistItem[] {
  if (myProviders.length === 0) return [];
  const mine = new Set(myProviders);
  return items
    .filter(i => i.status === 'vill_se' && !i.dropped)
    // BIN-814: the SUBSCRIPTION subset, never the broad availability array. This
    // tile's whole claim is "finns nu på din tjänst" — a title you would have to RENT
    // on Viaplay is not that, and `providers` cannot tell the two apart because
    // Viaplay (76) and TV4 Play (489) are returned under rent/buy while both are
    // typed flatrate. Reading the broad array here tells the user something they pay
    // extra for is already included.
    .filter(i => subscriptionProviderIds(i).some(p => mine.has(p)))
    .sort((a, b) => addedMs(a) - addedMs(b))
    .slice(0, limit);
}
