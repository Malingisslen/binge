import { librarySubState, seenEpisodeCode } from '@/lib/libraryView';
import type { WatchlistItem } from '@/types';

// BIN-86 — "Fortsätt titta / Näst på tur". A progress-driven Up Next surface,
// complementing the air-date-driven home focal. Cost-conscious: derived from
// PERSISTED fields only (lastWatchedSeason/Episode + librarySubState, both
// persisted-fields-only) — NO per-series TMDB fan-out on the home page (25
// SEK/mån cap). The precise next-unwatched-S/E + one-tap mark lives on the
// series page, where the season data is already loaded; here we surface where
// you left off and a jump-back link.

export interface ContinueWatchingEntry {
  item: WatchlistItem;
  seen: string | null; // "S2E10" — last episode marked, or null
  behind: boolean;     // librarySubState === 'ligger_efter' (sort to top)
}

/**
 * In-progress TV series ('mina', started), excluding ones we can tell are
 * finished ('avslutad'). Behind series first, then most-recently-active.
 */
export function pickContinueWatching(items: WatchlistItem[], limit = 6): ContinueWatchingEntry[] {
  const entries: ContinueWatchingEntry[] = [];
  for (const item of items) {
    if (item.mediaType !== 'tv' || item.status !== 'mina') continue;
    if (item.lastWatchedSeason == null) continue; // not started
    const sub = librarySubState(item);
    if (sub === 'avslutad') continue;             // finished — nothing to continue
    entries.push({ item, seen: seenEpisodeCode(item), behind: sub === 'ligger_efter' });
  }
  entries.sort((a, b) => {
    if (a.behind !== b.behind) return a.behind ? -1 : 1;            // behind first
    return b.item.updatedAt.getTime() - a.item.updatedAt.getTime(); // most recent activity
  });
  return entries.slice(0, limit);
}
