import { fsdb } from '@/lib/firebase/db';
import { getMovie, getTVShow } from '@/lib/tmdb/client';
import { extractSEProviders } from '@/lib/tmdb/providers';
import { buildBackfillUpdate } from './backfill.helpers';

export type { BackfillUpdate } from './backfill.helpers';
export { buildBackfillUpdate } from './backfill.helpers';

export interface BackfillProgress {
  total: number;
  processed: number;
  updated: number;
  refreshed: number;
  skipped: number;
  failed: number;
}

// Items där TMDB redan bekräftat samma SE-providers nyligare än så här
// hoppas över i nästa backfill-körning. SE-katalogerna rör sig ofta nog att
// 60 dagar är en bra balans mellan färskhet och TMDB-rate-limit-budget.
const STALE_AFTER_MS = 60 * 24 * 60 * 60 * 1000;

// Firestore Timestamp duck-typas på toMillis() — instanceof skulle kräva en
// statisk firebase/firestore-import (se lazy-laddningen i lib/firebase/db.ts).
function timestampToMs(val: unknown): number | null {
  if (val instanceof Date) return val.getTime();
  if (
    typeof val === 'object' && val !== null &&
    typeof (val as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return (val as { toMillis(): number }).toMillis();
  }
  return null;
}

// Walkar användarens watchlist och fyller i / uppdaterar genreIds + providers
// på items. Sätter alltid `providersCheckedAt` när TMDB svarat — gör att vi
// kan särskilja "checked-empty" från "never-checked" och skippa items som
// redan re-checkades nyligen (60 dagar). TMDB-anropen körs i små batchar
// (5 parallella) för att inte bränna rate-limit. `watch/providers` följer
// redan med i getMovie/getTVShow via append_to_response.
export async function backfillGenreIds(
  uid: string,
  onProgress?: (p: BackfillProgress) => void,
): Promise<BackfillProgress> {
  const { db, doc, collection, getDocs, updateDoc, serverTimestamp } = await fsdb();
  const snap = await getDocs(collection(db, 'users', uid, 'watchlist'));
  const cutoffMs = Date.now() - STALE_AFTER_MS;
  const needs = snap.docs.filter(d => {
    const data = d.data();
    const g = data.genreIds;
    const p = data.providers;
    const missingGenres = !Array.isArray(g) || g.length === 0;
    const missingProviders = !Array.isArray(p);
    const checkedAtMs = timestampToMs(data.providersCheckedAt);
    const isStale = checkedAtMs == null || checkedAtMs < cutoffMs;
    return missingGenres || missingProviders || isStale;
  });

  const state: BackfillProgress = {
    total: needs.length,
    processed: 0,
    updated: 0,
    refreshed: 0,
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
        const uniqueProviders = extractSEProviders(detail);

        const existingGenres = Array.isArray(data.genreIds) ? data.genreIds as number[] : [];
        const existingProviders = Array.isArray(data.providers) ? data.providers as number[] : null;

        const { update, contentChanged } = buildBackfillUpdate(
          existingGenres, existingProviders, genreIds, uniqueProviders, serverTimestamp(),
        );

        await updateDoc(doc(db, 'users', uid, 'watchlist', d.id), update);
        if (contentChanged) state.updated += 1;
        else state.refreshed += 1;
      } catch {
        state.failed += 1;
      }
    }));
    state.processed = Math.min(i + CONCURRENCY, needs.length);
    onProgress?.({ ...state });
  }

  return state;
}
