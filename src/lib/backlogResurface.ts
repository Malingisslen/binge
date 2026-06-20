import type { WatchlistItem } from '@/types';

// BIN-88 — "ville se — finns nu på din tjänst". Watchlists go stale; this
// resurfaces the most-forgotten vill_se titles that are streamable on a service
// the user already pays for. Pure: addedAt/providers/myProviders are all already
// denormalized on the watchlist doc, so no TMDB calls. (vill_se is film-only in
// the current status model — TV lives under 'mina'.)

function addedMs(item: WatchlistItem): number {
  return item.addedAt instanceof Date ? item.addedAt.getTime() : 0;
}

/**
 * Up to `limit` vill_se items whose denormalized `providers` intersect
 * `myProviders`, oldest `addedAt` first (most "forgotten"). Empty when the user
 * has no services selected (nothing to match against).
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
    .filter(i => (i.providers ?? []).some(p => mine.has(p)))
    .sort((a, b) => addedMs(a) - addedMs(b))
    .slice(0, limit);
}
