import { canonicalProviderId } from '@/lib/tmdb/providers';
import { passesLength, type LengthFilter } from '@/lib/filters/titleFilters';
import type { TMDBProviderData } from '@/types/tmdb';
import type { RecSortKey, RowTitle } from '@/types';

/**
 * The filters a row can only apply after it fetches more about each title: where it
 * streams and how long it is. Sorting rides along so it runs on the refined pool,
 * before rotation.
 */
export interface RowRefinement {
  /** Canonical provider ids the title must stream on, or null for no service filter. */
  providerIds: number[] | null;
  length: LengthFilter;
  sort: RecSortKey;
}

export const NO_REFINEMENT: RowRefinement = { providerIds: null, length: '', sort: 'relevance' };

export const titleKey = (t: { id: number; media_type: string }) => `${t.media_type}-${t.id}`;

/**
 * Keeps titles you can watch on one of the given services. A title counts when one
 * of its Swedish streaming offers (subscription, free or with ads) is on one of them;
 * renting and buying do not count. A title whose offers have not been fetched yet is
 * left out until they arrive, so the row never shows something the filter would later remove.
 */
export function keepOnServices<T extends { id: number; media_type: string }>(
  items: T[],
  providersByKey: Record<string, TMDBProviderData | undefined>,
  providerIds: number[],
): T[] {
  const wanted = new Set(providerIds.map(canonicalProviderId));
  return items.filter(item => {
    const data = providersByKey[titleKey(item)];
    if (!data) return false;
    const offers = [...(data.flatrate ?? []), ...(data.free ?? []), ...(data.ads ?? [])];
    return offers.some(p => wanted.has(canonicalProviderId(p.provider_id)));
  });
}

/** Rating ties break on vote count, so a score from a handful of votes cannot lead. */
export function sortRowTitles(items: RowTitle[], sort: RecSortKey): RowTitle[] {
  if (sort === 'rating') {
    return [...items].sort((a, b) =>
      (b.vote_average ?? 0) - (a.vote_average ?? 0) || (b.vote_count ?? 0) - (a.vote_count ?? 0));
  }
  if (sort === 'release') {
    const d = (x: RowTitle) => x.release_date || x.first_air_date || '';
    return [...items].sort((a, b) => d(b).localeCompare(d(a)));
  }
  return items;
}

export function refineTitles(
  items: RowTitle[],
  facts: {
    providersByKey: Record<string, TMDBProviderData | undefined>;
    runtimeByKey: Record<string, number | null | undefined>;
  },
  r: RowRefinement,
): RowTitle[] {
  let out = r.providerIds ? keepOnServices(items, facts.providersByKey, r.providerIds) : items;
  if (r.length) out = out.filter(t => passesLength(t.media_type, facts.runtimeByKey[titleKey(t)], r.length));
  return sortRowTitles(out, r.sort);
}
