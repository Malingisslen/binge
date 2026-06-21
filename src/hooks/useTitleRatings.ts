import { useQuery } from '@tanstack/react-query';
import type { Ratings, RatingsDoc } from '@/lib/ratings/types';
import { useAuth } from '@/hooks/useAuth';

/**
 * Fetch external ratings via the titleRatings callable. Query key 'title-ratings'
 * is intentionally NOT persisted (per-title data). Lazy-imports firebase/functions
 * to keep it out of first-load bundle (mirrors src/lib/firebase/reports.ts).
 *
 * Gated on authentication: the callable rejects anonymous calls (billing + Sentry
 * noise). uid is set immediately on onAuthStateChanged so there is no extra
 * waterfall for signed-in users (M3 fix).
 */
export function useTitleRatings(imdbId: string | null | undefined): Ratings | null {
  const { uid } = useAuth();
  const { data } = useQuery({
    queryKey: ['title-ratings', imdbId],
    enabled: !!imdbId && !!uid,
    staleTime: 1000 * 60 * 60 * 24, // ratings barely move; 1 day client-side
    queryFn: async (): Promise<RatingsDoc> => {
      const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import('firebase/functions');
      const app = (await import('@/lib/firebase/config')).default;
      const functions = getFunctions(app, 'europe-west1');
      if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true') {
        try { connectFunctionsEmulator(functions, '127.0.0.1', 5001); } catch { /* idempotent */ }
      }
      const call = httpsCallable<{ imdbId: string }, RatingsDoc>(functions, 'titleRatings');
      return (await call({ imdbId: imdbId! })).data;
    },
  });
  return data ?? null;
}
