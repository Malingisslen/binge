import { subscriptionProviderIds } from '@/lib/watchlist/subscriptionProviders';
import type { WatchlistItem } from '@/types';

type TallyRow = Pick<WatchlistItem, 'providers' | 'subscriptionProviders'>;

/**
 * BIN-845 — how many library titles each service carries, for the stats page bars.
 *
 * The bars answer "what can I watch on the things I pay for", so they count the
 * SUBSCRIPTION subset. Since BIN-814 the broad `providers` array also holds rent and
 * buy, and a type filter cannot undo that downstream: the SE catalogue returns
 * Viaplay (76) and TV4 Play (489) under rent/buy while both are typed flatrate. A
 * rented film therefore does not appear in these bars at all — the accepted trade
 * for the bars meaning exactly one thing.
 *
 * Extracted with `withProviderDataCount` so the pair stays honest: the page's own
 * "N av M titlar med streamingdata" caption must count the SAME field the bars do,
 * or it claims more titles are represented in the chart than actually are.
 */
export function providerTally(items: readonly TallyRow[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const item of items) {
    for (const pid of subscriptionProviderIds(item)) {
      out[pid] = (out[pid] ?? 0) + 1;
    }
  }
  return out;
}

/**
 * The caption's numerator: titles that actually contribute to a bar.
 *
 * It used to also admit anything carrying a `providersCheckedAt` stamp, which is now
 * exactly backwards. Every writer that sets `subscriptionProviders` stamps
 * `providersCheckedAt` in the same payload, so a rent-only title is `[]` WITH a
 * stamp — the disjunct would count it while it draws no bar, which is the overcount
 * the caption was narrowed to prevent.
 *
 * The case the stamp clause originally covered (the add path writes providers without
 * stamping, so stamp-only counting reported "0 av N" while bars rendered) is already
 * handled: `subscriptionProviderIds` falls back to `providers` for a row that has no
 * subscription answer yet.
 */
export function withProviderDataCount(items: readonly TallyRow[]): number {
  return items.filter(i => subscriptionProviderIds(i).length > 0).length;
}
