import { canonicalProviderId } from '@/lib/tmdb/providers';
import type { TMDBProviderData } from '@/types/tmdb';

/**
 * "Mina tjänster" keeps only titles you can watch on a service you have. A title
 * counts when one of its Swedish streaming offers (subscription, free or with ads)
 * is on one of your services; renting and buying do not count. A title whose
 * offers have not been fetched yet is left out until they arrive, so the row never
 * shows something the filter would later remove.
 */
export function keepOnMyServices<T extends { id: number; media_type: string }>(
  items: T[],
  providersByKey: Record<string, TMDBProviderData | undefined>,
  myProviders: number[],
): T[] {
  const mine = new Set(myProviders.map(canonicalProviderId));
  return items.filter(item => {
    const data = providersByKey[`${item.media_type}-${item.id}`];
    if (!data) return false;
    const offers = [...(data.flatrate ?? []), ...(data.free ?? []), ...(data.ads ?? [])];
    return offers.some(p => mine.has(canonicalProviderId(p.provider_id)));
  });
}
