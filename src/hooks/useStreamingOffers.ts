import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import { STREAMING_OFFERS_TIMEOUT_MESSAGE } from '@/lib/queryClient';
import type { Offer, StreamingOffersDoc } from '@/lib/streaming/offers';

/**
 * Read the shared streamingOffers doc for one title. Query key
 * 'streaming-offers' is intentionally NOT in PERSISTED_QUERY_PREFIXES (per-title
 * data must never be persisted to localStorage).
 *
 * BIN-523: the doc id is `${mediaType}_${tmdbId}` — TMDB movie ids and TV ids
 * are independent namespaces, so movie 123 and TV 123 used to share one doc and
 * show each other's "where to watch" rows. Docs written before the change keep
 * the bare `${tmdbId}` id; we fall back to those ONCE, and only when the legacy
 * doc's own `mediaType` matches, so a title keeps its offers until the
 * background refresh rewrites it under the new id.
 *
 * BIN-565 (2026-08-17): "until the background refresh rewrites it" was never going to
 * happen for every title. The refresh work set requires status `vill_se`/`mina`, so a
 * watched title leaves it permanently and its bare doc is never revisited — which is why
 * `runIdBackfill` (functions/src/streamingOffers/backfillIds.ts) now finishes the
 * migration outright. This fallback stays until an exhaustive query PROVES zero bare docs
 * remain; the migration completing is not the same as it being proven complete. Removing
 * it early costs a title its "Billigast: hyr för X kr" line with no visible error at all —
 * the provider logos come from TMDB and keep rendering, so the page looks fine.
 */
export function useStreamingOffers(
  tmdbId: number | undefined,
  mediaType: 'movie' | 'tv',
): { offers: Offer[]; checkedAt: number | null } {
  const { data } = useQuery({
    queryKey: ['streaming-offers', mediaType, tmdbId],
    enabled: tmdbId != null,
    staleTime: 1000 * 60 * 60, // 1h client cache; source refreshes daily server-side
    queryFn: async () => {
      if (tmdbId == null) return null; // enabled-gated; narrows for mediaTypeDocId
      const { db, doc, getDoc } = await fsdb();
      // BIN-157: bind läsningen mot en 10s-timeout. getDoc har ingen egen
      // tidsgräns, så ett hängande nät kunde låta offers-queryn aldrig settla
      // (titelsidan renderar ändå — offers är komplement — men queryn fastnade).
      // Timeouten spänner över BÅDA läsningarna, inte 10s per läsning.
      // BIN-733: felnamnet är delat med queryClients retry-predikat, som inte
      // gör om en query som redan slagit i sin egen tidsgräns — annars blir
      // väntan 10s + 1s backoff + 10s innan rutan ger upp.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(STREAMING_OFFERS_TIMEOUT_MESSAGE)),
          10_000,
        );
      });
      const read = async (): Promise<StreamingOffersDoc | null> => {
        const snap = await getDoc(doc(db, 'streamingOffers', mediaTypeDocId(mediaType, tmdbId)));
        if (snap.exists()) return snap.data() as StreamingOffersDoc;
        const legacy = await getDoc(doc(db, 'streamingOffers', String(tmdbId)));
        if (!legacy.exists()) return null;
        const legacyDoc = legacy.data() as StreamingOffersDoc;
        return legacyDoc.mediaType === mediaType ? legacyDoc : null;
      };
      try {
        return await Promise.race([read(), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
  });
  return { offers: data?.offers ?? [], checkedAt: data?.checkedAt ?? null };
}
