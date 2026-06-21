import { librarySubState, seenEpisodeCode } from '@/lib/libraryView';
import type { CalendarEntry } from '@/lib/calendar/types';
import type { WatchlistItem } from '@/types';

// BIN-86 — "Fortsätt titta / Näst på tur". A progress-driven Up Next surface,
// complementing the air-date-driven home focal. Cost-conscious: derived from
// PERSISTED fields only (lastWatchedSeason/Episode + librarySubState, both
// persisted-fields-only) — NO per-series TMDB fan-out on the home page (25
// SEK/mån cap). The precise next-unwatched-S/E + one-tap mark lives on the
// series page, where the season data is already loaded; here we surface where
// you left off and a jump-back link.
//
// Caught-up filtering (the "watched as long as possible" bug): a series you've
// caught up on has nothing to continue tonight and must NOT appear here. Two
// layers, cheap→accurate:
//   1. Persisted-only — drop a series once you're on/past the last KNOWN
//      season (totalSeasons), regardless of Ended vs Returning. Catches the
//      finished single-season and last-season cases without any TMDB call.
//   2. Calendar override — the dashboard already loads the calendar (aired
//      episodes per followed series) for the week strip; when an entry exists
//      for a show it is AUTHORITATIVE: keep the show only if an episode has
//      already aired that you haven't reached yet. This catches shows whose
//      season count was never backfilled (totalSeasons null) AND correctly
//      KEEPS a last-season show when a newer episode has aired. Zero extra cost.

export interface ContinueWatchingEntry {
  item: WatchlistItem;
  seen: string | null; // "S2E10" — last episode marked, or null
  behind: boolean;     // sort to top — genuinely behind on aired episodes
}

interface Pos { season: number; episode: number; }

function comparePos(a: Pos, b: Pos): number {
  return a.season - b.season || a.episode - b.episode;
}

function watchedPos(item: WatchlistItem): Pos {
  // == null guards: season 0 (Specials) and episode 0 (season auto-advance
  // sentinel) are both valid progress values.
  return { season: item.lastWatchedSeason ?? 0, episode: item.lastWatchedEpisode ?? 0 };
}

/** True once you're on or past the last season we have a count for. */
function caughtUpToLastKnownSeason(item: WatchlistItem): boolean {
  return (
    item.totalSeasons != null &&
    item.lastWatchedSeason != null &&
    item.lastWatchedSeason >= item.totalSeasons
  );
}

/**
 * Highest AIRED (air_date <= now) episode per show, from already-loaded
 * calendar entries. Future episodes (premiärbevakning) and movie releases are
 * ignored — "behind" is only about content that exists to watch right now.
 */
export function latestAiredEpisodeByShow(
  entries: CalendarEntry[],
  now: Date,
): Map<number, Pos> {
  const out = new Map<number, Pos>();
  for (const e of entries) {
    if (e.kind !== 'episode') continue;
    if (new Date(e.airDate + 'T00:00:00') > now) continue; // not aired yet
    const pos: Pos = { season: e.season, episode: e.episode };
    const cur = out.get(e.tmdbId);
    if (!cur || comparePos(pos, cur) > 0) out.set(e.tmdbId, pos);
  }
  return out;
}

/**
 * In-progress TV series ('mina', started) you can still continue. Excludes
 * series we can tell you're caught up on. Behind series first, then
 * most-recently-active.
 */
export function pickContinueWatching(
  items: WatchlistItem[],
  opts: { aired?: ReadonlyMap<number, Pos>; limit?: number } = {},
): ContinueWatchingEntry[] {
  const { aired, limit = 6 } = opts;
  const entries: ContinueWatchingEntry[] = [];
  for (const item of items) {
    if (item.mediaType !== 'tv' || item.status !== 'mina') continue;
    if (item.lastWatchedSeason == null) continue; // not started
    const sub = librarySubState(item);
    if (sub === 'avslutad') continue;             // finished — nothing to continue

    const airedPos = aired?.get(item.tmdbId);
    if (airedPos) {
      // Calendar is authoritative: in the row only if an aired episode is still
      // ahead of where you left off. Caught-up shows (incl. returning series
      // waiting for a new season) drop out here.
      if (comparePos(watchedPos(item), airedPos) >= 0) continue;
    } else if (caughtUpToLastKnownSeason(item)) {
      // No calendar data (still loading / TMDB failed): persisted-only fallback.
      continue;
    }
    // `behind` (the "Ligger efter" badge + sort-to-top) stays conservative and
    // consistent with the library: only a demonstrable backlog
    // (librarySubState === 'ligger_efter'), never just "one fresh episode aired".
    // The calendar decides inclusion, not the badge.
    entries.push({ item, seen: seenEpisodeCode(item), behind: sub === 'ligger_efter' });
  }
  entries.sort((a, b) => {
    if (a.behind !== b.behind) return a.behind ? -1 : 1;            // behind first
    return b.item.updatedAt.getTime() - a.item.updatedAt.getTime(); // most recent activity
  });
  return entries.slice(0, limit);
}
