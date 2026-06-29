'use client';

import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';
import type { PricePoint } from '@/lib/streaming/priceStats';

// BIN-354: read the shared, global priceHistory/{tmdbId} doc (public read,
// allow read: if true). Sparse points appended write-on-change by the
// streamingOffersRefresh cron. staleTime is long — price history moves slowly,
// and this is a per-title fan-out-able read so we keep it cheap.
export function usePriceHistory(tmdbId: number | undefined) {
  return useQuery({
    queryKey: ['price-history', tmdbId],
    queryFn: async (): Promise<PricePoint[]> => {
      const { db, doc, getDoc } = await fsdb();
      const snap = await getDoc(doc(db, 'priceHistory', String(tmdbId)));
      if (!snap.exists()) return [];
      const pts = snap.get('points');
      return Array.isArray(pts) ? (pts as PricePoint[]) : [];
    },
    enabled: tmdbId != null,
    staleTime: 60 * 60 * 1000, // 1h
  });
}
