import { collection, doc, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { getMovie, getTVShow } from '@/lib/tmdb/client';

export interface BackfillProgress {
  total: number;
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
}

// Walkar användarens watchlist och fyller i genreIds på items som saknar
// det. Körs som one-shot från settings — inte en återkommande operation.
// TMDB-anropen körs i små batchar (5 parallella) för att inte bränna rate-
// limit.
export async function backfillGenreIds(
  uid: string,
  onProgress?: (p: BackfillProgress) => void,
): Promise<BackfillProgress> {
  const snap = await getDocs(collection(db, 'users', uid, 'watchlist'));
  const needs = snap.docs.filter(d => {
    const g = d.data().genreIds;
    return !Array.isArray(g) || g.length === 0;
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
        if (genreIds.length === 0) {
          state.skipped += 1;
          return;
        }
        await updateDoc(doc(db, 'users', uid, 'watchlist', d.id), {
          genreIds,
          updatedAt: serverTimestamp(),
        });
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
