import { candidateKey } from './matching';

export interface MatchAnnouncementState {
  /** Keys of the matches seen on the previous run; null before the first run. */
  seenKeys: Set<string> | null;
  /** True once swipes have arrived, so matches that predate the page opening are not announced. */
  baselineSet: boolean;
}

export const INITIAL_MATCH_ANNOUNCEMENT_STATE: MatchAnnouncementState = { seenKeys: null, baselineSet: false };

type MatchLike = { candidate: { tmdbId: number; mediaType: string | null; title: string } };

/**
 * Decides what a screen reader should hear when the match list changes. Swipes load after the
 * session doc, so the baseline only counts as set once swipes exist; matches already there then
 * are the starting point, not news.
 */
export function nextMatchAnnouncement(
  state: MatchAnnouncementState,
  matches: MatchLike[],
  swipeCount: number,
): { announcement: string | null; state: MatchAnnouncementState } {
  const seenKeys = new Set(matches.map(m => candidateKey(m.candidate)));
  if (!state.baselineSet) {
    return { announcement: null, state: { seenKeys, baselineSet: swipeCount > 0 } };
  }
  const next = { seenKeys, baselineSet: true };
  if (!state.seenKeys) return { announcement: null, state: next };
  const fresh = matches.filter(m => !state.seenKeys!.has(candidateKey(m.candidate)));
  if (fresh.length === 0) return { announcement: null, state: next };
  return { announcement: `Ny match: ${fresh.map(m => m.candidate.title).join(', ')}`, state: next };
}
