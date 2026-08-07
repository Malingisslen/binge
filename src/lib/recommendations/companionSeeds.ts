// BIN-583 Fas 2 — which curated companion FILMS the recommendations cascade may
// offer, derived purely from the user's library. No TMDB I/O: the curated map
// (src/lib/franchise/companions.ts) already knows the relationship, so the row's
// existence is decided offline and the row is emitted ONLY when it has something
// to show. That is the whole point of the feature per Malin's 2026-08-06 call:
// a row that appears seldom and is right beats one that always appears and guesses.

import { companionFilmsFor, type CompanionTitle } from '@/lib/franchise/companions';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import type { WatchlistItem, WatchStatus, CompanionAnchor } from '@/types';

/**
 * Only "mina" (following) TV titles anchor the row — the ticket's wording
 * ("eftersom du följer X") is present tense, and it keeps the first version
 * narrow. Widening this to 'sedd' (a finished show still has a follow-up film)
 * is a deliberate, separate product call.
 */
const ANCHOR_TV_STATUSES: ReadonlyArray<WatchStatus> = ['mina'];

/**
 * Hard bound on the row's TMDB fan-out: one lite movie fetch per film. The
 * curated map is small today, but it is append-only and the cap is what keeps a
 * future growth spurt from turning one page load into dozens of requests
 * (Firebase/TMDB cost discipline).
 */
export const COMPANION_FILM_CAP = 12;

/**
 * Pick the companion anchors for this library snapshot.
 *
 * A film already in the library (ANY status — seen, want-to-see, dropped) is
 * dropped: every other cascade row excludes the whole library, and something
 * already on your list is not a recommendation. Films the user marked "inte
 * intresserad" are NOT known here (that list lives outside the cascade); the row
 * hook's `dedupeAndExclude` removes those, and an emptied row renders nothing.
 *
 * Anchors come back sorted by show title so the row is deterministic regardless
 * of the order Firestore handed the watchlist over.
 */
export function selectCompanionAnchors(items: readonly WatchlistItem[]): CompanionAnchor[] {
  const inLibrary = new Set(items.map(i => mediaTypeDocId(i.mediaType, i.tmdbId)));

  const shows = items
    .filter(i => i.mediaType === 'tv' && ANCHOR_TV_STATUSES.includes(i.status))
    .sort((a, b) => a.title.localeCompare(b.title, 'sv') || a.tmdbId - b.tmdbId);

  const claimed = new Set<string>();
  const anchors: CompanionAnchor[] = [];
  let budget = COMPANION_FILM_CAP;

  for (const show of shows) {
    if (budget <= 0) break;
    const films: CompanionTitle[] = [];
    for (const film of companionFilmsFor('tv', show.tmdbId)) {
      if (films.length >= budget) break;
      const key = mediaTypeDocId('movie', film.id);
      // `claimed` guards the (curated-data) case of one film reachable from two
      // followed shows — it must be offered once, under one anchor.
      if (inLibrary.has(key) || claimed.has(key)) continue;
      claimed.add(key);
      films.push(film);
    }
    if (films.length === 0) continue;
    budget -= films.length;
    anchors.push({ showTmdbId: show.tmdbId, showTitle: show.title, films });
  }

  return anchors;
}

/**
 * The `mediaTypeDocId` keys of every film the companion row can show this pass.
 *
 * Cross-row dedup (a binding condition of the #28 panel critique): these films
 * are reachable from the same `mina`-TV seed pool as similar/latest-fav/upcoming,
 * and `dedupeAndExclude` only dedupes WITHIN a row. The hub feeds this set to
 * every OTHER row as an exclusion, so a companion film is shown once per pass —
 * in the row that explains why it's there.
 */
export function companionFilmKeys(anchors: readonly CompanionAnchor[]): Set<string> {
  const keys = new Set<string>();
  for (const a of anchors) {
    for (const f of a.films) keys.add(mediaTypeDocId('movie', f.id));
  }
  return keys;
}
