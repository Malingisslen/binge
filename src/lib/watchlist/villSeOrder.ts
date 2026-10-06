import { subscriptionProviderIds } from '@/lib/watchlist/subscriptionProviders';
import { canonicalProviderId } from '@/lib/tmdb/providers';
import type { WatchlistItem } from '@/types';

/** A runtime-lensed pick, as `applyRuntimeBudget` produces it. */
export interface LensedPick {
  item: WatchlistItem;
  unknownRuntime: boolean;
}

/**
 * The choosing-moment order for /my/vill-se: what you can watch RIGHT NOW first,
 * then most recently added. Titles of unknown length sink to the bottom (BIN-167)
 * so the list leads with the safe choices.
 *
 * BIN-814 — "can watch right now" means covered by a subscription, not merely
 * obtainable. The SE catalogue returns Viaplay (76) and TV4 Play (489) under
 * rent/buy while both are typed flatrate, so ranking on the broad `providers`
 * array promises a tonight-watch that would actually cost extra. The poster dots
 * on the same card are keyed to the same rule, and the page's caption says so.
 *
 * Extracted from the component's useMemo so the rule is testable without mounting
 * the watchlist and auth contexts — before this it had no coverage at all, which
 * is how the dots and the ranking came to disagree in the first place.
 */
export function orderVillSePicks(
  lensed: readonly LensedPick[],
  myProviders: ReadonlySet<number>,
): LensedPick[] {
  // Båda sidorna kan bära ett alias (HBO Max 1899 för 384); prickarna jämför
  // tjänsten, inte id:t, och sorteringen måste göra detsamma.
  const mine = new Set([...myProviders].map(canonicalProviderId));
  const onMine = (i: WatchlistItem) => subscriptionProviderIds(i).some(p => mine.has(canonicalProviderId(p)));
  return [...lensed].sort((a, b) => {
    if (a.unknownRuntime !== b.unknownRuntime) return a.unknownRuntime ? 1 : -1;
    const am = onMine(a.item) ? 0 : 1;
    const bm = onMine(b.item) ? 0 : 1;
    if (am !== bm) return am - bm;
    return b.item.addedAt.getTime() - a.item.addedAt.getTime();
  });
}
