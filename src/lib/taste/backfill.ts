import { collection, doc, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { getMovie, getTVShow } from '@/lib/tmdb/client';
import { canonicalProviderId } from '@/lib/tmdb/providers';

export interface BackfillProgress {
  total: number;
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
}

// Walkar användarens watchlist och fyller i genreIds + providers på items
// som saknar något av dem. Körs som one-shot från settings — inte en
// återkommande operation. TMDB-anropen körs i små batchar (5 parallella)
// för att inte bränna rate-limit. `watch/providers` följer redan med i
// getMovie/getTVShow via append_to_response, så ingen extra request per item.
export async function backfillGenreIds(
  uid: string,
  onProgress?: (p: BackfillProgress) => void,
): Promise<BackfillProgress> {
  const snap = await getDocs(collection(db, 'users', uid, 'watchlist'));
  const needs = snap.docs.filter(d => {
    const data = d.data();
    const g = data.genreIds;
    const p = data.providers;
    const missingGenres = !Array.isArray(g) || g.length === 0;
    const missingProviders = !Array.isArray(p) || p.length === 0;
    return missingGenres || missingProviders;
  });

  const state: BackfillProgress = {
    total: needs.length,
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
  onProgress?.(state);

  const CONCURRENCY = 5;
  for (let i = 0; i < needs.length; i += CONCURRENCY) {
    const chunk = needs.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async d => {
      const data = d.data();
      const tmdbId = data.tmdbId as number;
      const mediaType = data.mediaType as string;
      if (!tmdbId || (mediaType !== 'movie' && mediaType !== 'tv')) {
        state.skipped += 1;
        return;
      }
      try {
        const detail = mediaType === 'movie' ? await getMovie(tmdbId) : await getTVShow(tmdbId);
        const genreIds = detail.genres?.map(g => g.id) ?? [];
        const se = detail['watch/providers']?.results?.SE;
        const rawProviders = [
          ...(se?.flatrate ?? []),
          ...(se?.free ?? []),
          ...(se?.ads ?? []),
        ].map(p => canonicalProviderId(p.provider_id));
        const uniqueProviders = Array.from(new Set(rawProviders));

        const update: Record<string, unknown> = { updatedAt: serverTimestamp() };
        const existingGenres = Array.isArray(data.genreIds) ? data.genreIds : [];
        const existingProviders = Array.isArray(data.providers) ? data.providers : [];
        if (existingGenres.length === 0 && genreIds.length > 0) update.genreIds = genreIds;
        if (existingProviders.length === 0 && uniqueProviders.length > 0) update.providers = uniqueProviders;

        if (Object.keys(update).length === 1) {
          state.skipped += 1;
          return;
        }
        await updateDoc(doc(db, 'users', uid, 'watchlist', d.id), update);
        state.updated += 1;
      } catch {
        state.failed += 1;
      }
    }));
    state.processed = Math.min(i + CONCURRENCY, needs.length);
    onProgress?.({ ...state });
  }

  return state;
}
