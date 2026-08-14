// BIN-583 Fas 2 — which curated companion FILMS the recommendations cascade may
// offer, derived purely from the user's library. No TMDB I/O: the curated map
// (src/lib/franchise/companions.ts) already knows the relationship, so the row's
// existence is decided offline and the row is emitted ONLY when it has something
// to show. That is the whole point of the feature per Malin's 2026-08-06 call:
// a row that appears seldom and is right beats one that always appears and guesses.

import { companionFilmsFor, type CompanionTitle } from '@/lib/franchise/companions';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import { librarySubState } from '@/lib/libraryView';
import type { WatchlistItem, WatchStatus, CompanionAnchor, CompanionAnchorReason } from '@/types';

/**
 * Which TV statuses anchor the row. `mina` only — and that is NOT the narrow
 * choice an earlier comment here claimed it was.
 *
 * The old note said widening to `sedd` would let finished shows anchor. That was
 * wrong about the data model: `sedd` is the FILM status. A series never moves out
 * of `mina` when the user finishes it — it only leaves for `avbruten` (dropped).
 * "Has the user finished this show" is a derived SUB-state of `mina`
 * (`librarySubState(item) === 'avslutad'`), not a status of its own.
 *
 * So finished shows have anchored this row since day one. BIN-811 does not widen
 * the pool; it stops calling them shows the user "follows". Do not "fix" this by
 * adding a status here.
 */
const ANCHOR_TV_STATUSES: ReadonlyArray<WatchStatus> = ['mina'];

/**
 * Persisted-fields-only, by design: no TMDB call, no live signals, nothing this
 * row would otherwise have had to fetch. `librarySubState`'s two optional live
 * arguments are deliberately NOT passed — the Streaming advisor owns those and
 * the cascade must not depend on whether it has loaded.
 *
 * Consequence, written down rather than discovered later: a finished show whose
 * `tmdbStatus`/`totalSeasons` were never lazy-backfilled answers `'following'`.
 * One-directional and safe — the row can under-claim ("du följer" on a show that
 * ended), never over-claim ("har sett klart" on a show still airing).
 *
 * That under-claim is VISIBLE ACROSS SURFACES, not just internal: WatchlistPage
 * passes the advisor's live signals to the same function, so /my/series can file
 * a never-backfilled show under "Avslutade" while this row still says "du följer"
 * about it. Accepted: the alternative is making a recommendation row's copy
 * depend on whether an unrelated surface has finished loading, which would make
 * the same page read differently between two renders.
 */
function anchorReason(show: WatchlistItem): CompanionAnchorReason {
  return librarySubState(show) === 'avslutad' ? 'finished' : 'following';
}

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
 * of the order Firestore handed the watchlist over. The sort is by TITLE only —
 * `reason` deliberately does not group or reorder them, because the film budget
 * below is spent in sort order and reordering would silently change WHICH films
 * a user with more anchors than budget is offered.
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
    anchors.push({
      showTmdbId: show.tmdbId,
      showTitle: show.title,
      reason: anchorReason(show),
      films,
    });
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
