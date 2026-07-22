import { fsdb } from './db';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';

// "Rensa helt"-vägen vid borttagning av en serie. WatchlistContext.removeItem
// raderar watchlist-docen, men per-avsnitt-historiken bor i en egen
// subcollection (users/{uid}/episodeProgress/{tmdbId}) och lämnas medvetet
// kvar — den som lägger tillbaka serien återupptar där hen var. Den här
// helpern är opt-out: raderar historik-docen på användarens uttryckliga
// begäran (toast-åtgärden "Rensa helt" i StatusButton/QuickAddButton).
// Policy dokumenterad i docs/data-retention-policy.md.
export async function clearEpisodeProgress(uid: string, tmdbId: number): Promise<void> {
  const { db, doc, deleteDoc } = await fsdb();
  // TV-only collection → namespaced doc id is always tv_${tmdbId} (BIN-560 Phase 4).
  await deleteDoc(doc(db, 'users', uid, 'episodeProgress', mediaTypeDocId('tv', tmdbId)));
}
