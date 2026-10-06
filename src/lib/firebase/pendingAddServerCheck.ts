import { fsdb } from '@/lib/firebase/db';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import type { MediaType } from '@/types';

/**
 * BIN-1442 — is this title already in the library ON THE SERVER?
 *
 * The library counts as known as soon as its first snapshot lands, and that
 * snapshot can come from the device cache. A title added from another device
 * since then would look absent, and the pending add's merge-write would replace
 * its status (a "Sedd" film back to "Vill se"). The pending add is the one write
 * nobody chose from a menu, so it pays one read to ask the server first.
 *
 * Answers `null` when the server cannot be reached; the caller then falls back to
 * what the cache said.
 */
export async function existsOnServer(uid: string, mediaType: MediaType, tmdbId: number): Promise<boolean | null> {
  try {
    const { db, doc, getDocFromServer } = await fsdb();
    const snap = await getDocFromServer(doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId)));
    return snap.exists();
  } catch {
    return null;
  }
}
