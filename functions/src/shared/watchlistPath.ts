/**
 * Which `collectionGroup('watchlist')` rows belong to a USER.
 *
 * `collectionGroup('watchlist')` matches every `watchlist` subcollection in the
 * database, which is two different things: `users/{uid}/watchlist/{id}`, a
 * person's own library, and `groups/{gid}/watchlist/{id}`, a group's shared list.
 * Firestore cannot scope a collection-group query by parent, so every reader
 * filters on the document PATH after the read.
 *
 * BIN-1291: a reader that skips this and takes the recipient from
 * `ref.parent.parent.id` reads a GROUP id as a user id. Group documents carry no
 * field allowlist, so a member can write a `status` into one, and a group created
 * with the same id as a real account would then route that row's title into the
 * account's notifications. Every reader filters here, and a test in
 * `functions/src/shared/watchlistPath.test.ts` requires it of every file that runs
 * the query.
 *
 * Moved here from `tmdbTosSweep/logic.ts` (BIN-504), which re-exports it.
 */

/** A user library row is exactly `users/{uid}/watchlist/{id}`. */
export function isUserWatchlistDocPath(path: string): boolean {
  const segments = path.split('/');
  return segments.length === 4 && segments[0] === 'users' && segments[2] === 'watchlist';
}

/**
 * The page's rows that belong to a user, in order.
 *
 * Filters only what is PROCESSED. A pagination cursor must still come from the
 * unfiltered page, or a page of only group rows would end the scan early.
 */
export function onlyUserWatchlistDocs<T extends { readonly ref: { readonly path: string } }>(
  docs: readonly T[],
): T[] {
  return docs.filter((d) => isUserWatchlistDocPath(d.ref.path));
}
