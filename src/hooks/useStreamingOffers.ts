import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';
import type { Offer, StreamingOffersDoc } from '@/lib/streaming/offers';

/**
 * Read the shared streamingOffers/{tmdbId} doc. Query key 'streaming-offers'
 * is intentionally NOT in PERSISTED_QUERY_PREFIXES (per-title data must never
 * be persisted to localStorage).
 */
export function useStreamingOffers(tmdbId: number | undefined): { offers: Offer[]; checkedAt: number | null } {
  const { data } = useQuery({
    queryKey: ['streaming-offers', tmdbId],
    enabled: tmdbId != null,
    staleTime: 1000 * 60 * 60, // 1h client cache; source refreshes daily server-side
    queryFn: async () => {
      const { db, doc, getDoc } = await fsdb();
      const snap = await getDoc(doc(db, 'streamingOffers', String(tmdbId)));
      return snap.exists() ? (snap.data() as StreamingOffersDoc) : null;
    },
  });
  return { offers: data?.offers ?? [], checkedAt: data?.checkedAt ?? null };
}
