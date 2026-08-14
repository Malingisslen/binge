import type { MediaType, WatchStatus, WatchlistItem } from '@/types';

/** Not acceptable from a caller. Most are filled by the context; two are here
 *  because the add path refuses to write them at all:
 *   - `notes` — notes live in the owner-only `watchlistNotes` subcollection
 *     (BIN-505), so accepting one would be a lie.
 *   - `addedAtIsFallback` (BIN-640) — derived at READ time from whether the doc
 *     had a stored `addedAt`; it is never persisted. Listing it here is what stops
 *     `Carryable` from structurally admitting it onto `WatchlistAddPayload`, where
 *     it would ride into the merge-write and fail the whole thing against
 *     firestore.rules' `hasOnly` allowlist. That is the failure `notes` caused. */
type ServerOwned =
  | 'addedAt' | 'addedAtIsFallback' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount'
  | 'providersCheckedAt' | 'visibility' | 'notes';

/** Identity + display fields. Every call knows these, so they are always written. */
type AlwaysWritten = 'tmdbId' | 'mediaType' | 'status' | 'title' | 'posterPath' | 'releaseYear';

/** Fields a re-mark may not know. Optional BECAUSE omitting is how we preserve them. */
type Carryable = Exclude<keyof WatchlistItem, ServerOwned | AlwaysWritten>;

/**
 * The exact shape `WatchlistContext`'s two add entry points accept — `upsertTitle`
 * (bulk) and `logViewing` (a human logging a watch). Same payload, both doors.
 *
 * NOTE — `providers` and `genreIds` may now be **absent**, not merely empty, on a
 * watchlist doc: a re-mark that doesn't know them omits the key so the stored value
 * survives. Every genuine NEW add passes them explicitly (`[]` when unknown) so a
 * created doc still satisfies `WatchlistItem`'s non-optional array contract — but any
 * new reader that touches a raw `doc.data()` instead of going through `docToItem`
 * MUST guard with `Array.isArray(...)` rather than assuming presence.
 */
export type WatchlistAddPayload =
  Pick<WatchlistItem, AlwaysWritten> & Partial<Pick<WatchlistItem, Carryable>>;

export interface BuildWatchlistAddPayloadInput {
  tmdbId: number;
  mediaType: MediaType;
  status: WatchStatus;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  /**
   * The existing library row, when this add is really a re-mark of a title the user
   * already tracks. Pass it whenever it might exist — it is what lets an unsupplied
   * field resolve to the value the user already has instead of being left to the
   * server copy.
   */
  current?: WatchlistItem | null;
  rating?: number | null;
  totalSeasons?: number | null;
  lastWatchedSeason?: number | null;
  lastWatchedEpisode?: number | null;
  providers?: number[];
  /** BIN-814: the flatrate/free/ads subset. Always supply it when supplying `providers`. */
  subscriptionProviders?: number[];
  genreIds?: number[];
  tmdbStatus?: string | null;
}

/**
 * One place that builds the add payload.
 *
 * **Read the merge contract before changing this.** The add path writes with
 * `setDoc(…, { merge: true })`, so for any given key:
 *
 * * key ABSENT from the payload → Firestore keeps whatever is stored.
 * * key present with a value    → that value is written.
 * * key present with `null`     → the stored value is DESTROYED.
 *
 * That is why "fill every field with a default" is the wrong shape here, and why an
 * earlier version of this helper — which substituted `null`/`[]` whenever it had
 * nothing better — could wipe a rating and a user's episode position on a status
 * change made before the watchlist snapshot had settled (`current` is null then, so
 * every carry fell through to its default). The fix is to write nothing at all when
 * we know nothing.
 *
 * Precedence per field, in order:
 *   1. the caller supplied something — including an explicit `null`, which MEANS
 *      "clear this" and is used deliberately (`StatusButton`'s `totalSeasons`);
 *   2. otherwise `current`'s value, when it holds one;
 *   3. otherwise the key is OMITTED, and the stored value survives untouched.
 *
 * A caller that wants a null of its own to mean "leave it alone" rather than "clear
 * it" says so at the call site with `?? undefined` — explicit and greppable, instead
 * of this helper guessing which of the two a given null meant.
 */
export function buildWatchlistAddPayload(input: BuildWatchlistAddPayloadInput): WatchlistAddPayload {
  const { current } = input;

  const payload: WatchlistAddPayload = {
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    status: input.status,
    title: input.title,
    posterPath: input.posterPath,
    releaseYear: input.releaseYear,
  };

  /** Assign only when we have something to say; silence preserves the stored value. */
  const carry = <K extends Carryable>(
    key: K,
    value: WatchlistItem[K] | undefined,
    currentValue: WatchlistItem[K] | null | undefined,
  ): void => {
    if (value !== undefined) payload[key] = value;
    else if (currentValue != null) payload[key] = currentValue;
  };

  carry('rating', input.rating, current?.rating);
  carry('totalSeasons', input.totalSeasons, current?.totalSeasons);
  carry('lastWatchedSeason', input.lastWatchedSeason, current?.lastWatchedSeason);
  carry('lastWatchedEpisode', input.lastWatchedEpisode, current?.lastWatchedEpisode);
  carry('providers', input.providers, current?.providers);
  // BIN-814: carried BESIDE providers, never instead of it. An add that writes the
  // broad field also stamps providersCheckedAt (shouldStampProvidersAtAdd), and the
  // title-page repair is gated on that stamp — so an add that omitted the subset
  // would lock the advisor onto the broad fallback for a full 60 days, on the most
  // common way a title enters the library. That is the ticket's own headline case.
  carry('subscriptionProviders', input.subscriptionProviders, current?.subscriptionProviders);
  carry('genreIds', input.genreIds, current?.genreIds);
  carry('tmdbStatus', input.tmdbStatus, current?.tmdbStatus);

  return payload;
}
