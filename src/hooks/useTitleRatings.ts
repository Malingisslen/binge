import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';
import type { Ratings, RatingsDoc } from '@/lib/ratings/types';

/**
 * Public ratings: read the shared cached titleRatings/{imdbId} doc directly
 * (no auth, no App Check on the hot path). On a cache miss, best-effort trigger
 * the capped backfill callable. Query key 'title-ratings' is NOT persisted.
 */
export function useTitleRatings(imdbId: string | null | undefined): Ratings | null {
  const { data } = useQuery({
    queryKey: ['title-ratings', imdbId],
    enabled: !!imdbId,
    staleTime: 1000 * 60 * 60 * 24,
    queryFn: async (): Promise<RatingsDoc | null> => {
      const { db, doc, getDoc } = await fsdb();
      const snap = await getDoc(doc(db, 'titleRatings', imdbId!));
      if (snap.exists()) return snap.data() as RatingsDoc;
      // cache miss → best-effort capped backfill, then return its result
      try {
        const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import('firebase/functions');
        const app = (await import('@/lib/firebase/config')).default;
        const functions = getFunctions(app, 'europe-west1');
        if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true') {
          try { connectFunctionsEmulator(functions, '127.0.0.1', 5001); } catch { /* idempotent */ }
        }
        const call = httpsCallable<{ imdbId: string }, RatingsDoc>(functions, 'titleRatings');
        return (await call({ imdbId: imdbId! })).data;
      } catch {
        return null; // backfill failed or daily cap reached — render nothing, gracefully
      }
    },
  });
  return data ?? null;
}
