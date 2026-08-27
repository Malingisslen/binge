import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import type { MediaType } from '@/types';

/**
 * The `uid:docId` string `WatchlistContext` keys its per-title caches by.
 *
 * BIN-1022. Three places built this formula for themselves — `cacheKey` in
 * `updateProgress`, `dedupeKey` in `refreshTmdbFields`, `docKey` in `removeItem` (BIN-1012
 * merged two of an earlier four). They are not independent: `removeItem` WRITES the
 * removal generation under this key and `updateProgress` READS it. If the two ever
 * disagree the guard stops guarding and nothing turns red — the file already says as much
 * in the doc comment above `isLibraryKnown`.
 *
 * Pure and synchronous on purpose. Every call site has its own ordering condition against
 * its first `await` (see each one's comment), and a helper that cannot await cannot move
 * any of them.
 */
export function watchlistDocKey(uid: string, mediaType: MediaType, tmdbId: number): string {
  return `${uid}:${mediaTypeDocId(mediaType, tmdbId)}`;
}
