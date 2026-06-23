/**
 * BIN-188 — "Serien är tillbaka": pure qualification + dedupe logic for the
 * dormancy-return push. Reuses the shared sub-state derivation so server and
 * client agree on who counts as "caught up".
 *
 * Distinct from episodeReleaseNotify (which fires when an episode AIRS, off
 * last_episode_to_air, for 'ikapp' followers). This fires when TMDB announces a
 * SEASON PREMIERE (next_episode_to_air.episode_number === 1) on a show a user
 * had reached 'ikapp' or 'avslutad' — the return-from-dormancy moment. Limiting
 * to episode 1 keeps it to "a new season is coming", not weekly mid-season
 * episodes (those are episodeReleaseNotify's job), and avoids double-notifying.
 *
 * No firebase-admin import — runs under the root Vitest suite.
 */

import { deriveSubState, type WatchlistLite, type LastEpisode } from '../episodeNotify/logic';

export interface NextEpisode {
  id: number;
  season_number: number;
  episode_number: number;
  air_date: string | null;
}

// A follower is "caught up" (and thus a candidate for a return nudge) when they
// have progress and are not behind — i.e. 'ikapp' (caught up, returning) or
// 'avslutad' (caught up, ended). 'aktiv' (behind) and 'none' (no progress / not
// followed) do not qualify: someone who never started shouldn't get a "it's
// back" nudge, and someone behind already has unwatched episodes.
export function isCaughtUp(item: WatchlistLite, tmdbStatus: string | null, last: LastEpisode | null): boolean {
  const s = deriveSubState(item, tmdbStatus, last);
  return s === 'ikapp' || s === 'avslutad';
}

// Show-level gate: TMDB announced the premiere of a LATER season we haven't
// notified for yet. season_number > 1 + episode_number === 1 = "the show is
// coming back" (a return), which excludes a first-ever S1E1 premiere (the show
// never aired, so it can't "return"). The id-dedupe prevents re-firing every
// run while the same premiere is pending.
export function shouldNotifyReturn(next: NextEpisode | null, lastNotifiedNextId: number | null): boolean {
  if (!next) return false;
  if (next.episode_number !== 1 || next.season_number <= 1) return false;
  return next.id !== lastNotifiedNextId;
}
