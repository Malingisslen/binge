import { fsdb } from '@/lib/firebase/db';
import { getMovie, getTVShow } from '@/lib/tmdb/client';
import { seProviderIdsForRefresh, seSubscriptionProviderIdsForRefresh } from '@/lib/tmdb/seProviderIds';
import { buildBackfillUpdate, needsBackfill, STALE_AFTER_MS } from './backfill.helpers';

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
  const needs = snap.docs.filter(d => needsBackfill(d.data(), cutoffMs));

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
        // BIN-814: the SAME derivation the title page uses, so the two writers can no
        // longer disagree about what `providers` means. Both fields come from this one
        // detail object, and both are `undefined` when it carries no SE block.
        const uniqueProviders = seProviderIdsForRefresh(detail);
        const uniqueSubscriptionProviders = seSubscriptionProviderIdsForRefresh(detail);

        const existingGenres = Array.isArray(data.genreIds) ? data.genreIds as number[] : [];
        const existingProviders = Array.isArray(data.providers) ? data.providers as number[] : null;
        const existingSubscriptionProviders = Array.isArray(data.subscriptionProviders)
          ? data.subscriptionProviders as number[]
          : null;

        const { update, contentChanged, wroteSubscriptionProviders } = buildBackfillUpdate(
          existingGenres, existingProviders, genreIds, uniqueProviders, serverTimestamp(),
          existingSubscriptionProviders, uniqueSubscriptionProviders,
        );

        await updateDoc(doc(db, 'users', uid, 'watchlist', d.id), update);
        // BIN-814: filling in the subscription subset counts as "updated" for the
        // progress readout — the row really did gain a field — but it is NOT
        // `contentChanged`, which is reserved for the user-visible change that may
        // bump `updatedAt`. Keeping the two apart is what stops the first run from
        // re-dating every row in the library.
        if (contentChanged || wroteSubscriptionProviders) state.updated += 1;
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
