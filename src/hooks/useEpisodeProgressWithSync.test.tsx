// src/hooks/useEpisodeProgressWithSync.test.tsx
//
// BIN-679. This hook is the ONLY thing standing between "I ticked a Doctor Who
// special" and "the app thinks I'm on season 0 of a 14-season show". The curated
// season-0 section was read-only for exactly that reason until this ticket; the
// guard here is what replaced the ban.
//
// #27's binding criterion 1 says the proof must be that the marker is not written —
// not that a label didn't change. So these drive the real hook and assert against
// `updateProgress`, which is the single call that writes lastWatchedSeason/Episode
// AND (inside WatchlistContext) fans out to syncProgressToGroups. One call, both
// consequences: if it never fires for season 0, criterion 1 and criterion 4 are both
// discharged structurally rather than by a second assertion on a second mock.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { EpisodeProgress } from '@/types';

const base = vi.hoisted(() => ({
  progress: null as EpisodeProgress | null,
  markEpisodeWatched: vi.fn(async () => {}),
  markSeasonWatched: vi.fn(async () => {}),
  markSeasonUnwatched: vi.fn(async () => {}),
}));
const updateProgress = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('./useEpisodeProgress', () => ({
  useEpisodeProgress: () => ({
    progress: base.progress,
    progressLoading: false,
    isWatched: () => false,
    markEpisodeWatched: base.markEpisodeWatched,
    markSeasonWatched: base.markSeasonWatched,
    markSeasonUnwatched: base.markSeasonUnwatched,
    getSeasonProgress: () => ({ watched: 0, total: 0 }),
    getTotalProgress: () => 0,
  }),
}));
vi.mock('./useWatchlist', () => ({ useWatchlist: () => ({ updateProgress }) }));

import { useEpisodeProgressWithSync } from './useEpisodeProgressWithSync';

/** Build an EpisodeProgress from a { season: { episode: watched } } shorthand. */
function progressOf(spec: Record<number, Record<number, boolean>>): EpisodeProgress {
  const seasons: EpisodeProgress['seasons'] = {};
  for (const [season, eps] of Object.entries(spec)) {
    seasons[season] = {};
    for (const [ep, watched] of Object.entries(eps)) {
      seasons[season][ep] = { watched, watchedAt: watched ? new Date('2026-01-01') : null };
    }
  }
  return { tmdbId: 57243, seasons };
}

const DOCTOR_WHO = 57243;

beforeEach(() => {
  vi.clearAllMocks();
  base.progress = null;
});

describe('season 0 never reaches the watchlist marker (BIN-679)', () => {
  it('ticking a special writes episodeProgress and nothing else', async () => {
    const { result } = renderHook(() => useEpisodeProgressWithSync(DOCTOR_WHO));
    await act(async () => { await result.current.markEpisodeWatched(0, 17, true); });

    expect(base.markEpisodeWatched).toHaveBeenCalledWith(0, 17, true);
    expect(updateProgress).not.toHaveBeenCalled();
  });

  it('un-ticking a special writes episodeProgress and nothing else', async () => {
    const { result } = renderHook(() => useEpisodeProgressWithSync(DOCTOR_WHO));
    await act(async () => { await result.current.markEpisodeWatched(0, 17, false); });

    expect(base.markEpisodeWatched).toHaveBeenCalledWith(0, 17, false);
    expect(updateProgress).not.toHaveBeenCalled();
  });

  // The auto-advance is the subtlest way a special could reach the marker: pass an
  // episodeCount, tick the "finale", and the numbered path jumps to season+1. For
  // season 0 that would write { season: 1, episode: 0 } — silently RESETTING a
  // 14-season viewer to the start of season 1. The guard returns before it.
  it('does not auto-advance out of season 0 even when handed an episodeCount', async () => {
    base.progress = progressOf({ 0: { 17: true } });
    const { result } = renderHook(() => useEpisodeProgressWithSync(DOCTOR_WHO));
    await act(async () => { await result.current.markEpisodeWatched(0, 17, true, 17); });

    expect(updateProgress).not.toHaveBeenCalled();
  });

  it('markSeasonWatched and markSeasonUnwatched are guarded too', async () => {
    const { result } = renderHook(() => useEpisodeProgressWithSync(DOCTOR_WHO));
    await act(async () => { await result.current.markSeasonWatched(0, 5); });
    await act(async () => { await result.current.markSeasonUnwatched(0, [1, 2]); });

    expect(base.markSeasonWatched).toHaveBeenCalledWith(0, 5);
    expect(base.markSeasonUnwatched).toHaveBeenCalledWith(0, [1, 2]);
    expect(updateProgress).not.toHaveBeenCalled();
  });

  // The regression a tick-path-only guard misses, driven end to end through the hook
  // rather than through the helper. Watched specials sit in episodeProgress; the user
  // un-ticks their only watched numbered episode. The marker must fall back to 0,0
  // ("nothing watched"), never to the special's position.
  it('un-ticking the last numbered episode falls back to 0,0, not to a watched special', async () => {
    base.progress = progressOf({ 0: { 13: true, 17: true }, 1: { 1: true } });
    const { result } = renderHook(() => useEpisodeProgressWithSync(DOCTOR_WHO));
    await act(async () => { await result.current.markEpisodeWatched(1, 1, false); });

    expect(updateProgress).toHaveBeenCalledTimes(1);
    expect(updateProgress).toHaveBeenCalledWith('tv', DOCTOR_WHO, 0, 0);
  });

  // Un-marking a whole numbered season takes a different code path to the same
  // fallback (markSeasonUnwatched → highestWatchedPosition with excludeSeason).
  it('clearing a whole numbered season also refuses to fall back onto a special', async () => {
    base.progress = progressOf({ 0: { 13: true }, 1: { 1: true, 2: true } });
    const { result } = renderHook(() => useEpisodeProgressWithSync(DOCTOR_WHO));
    await act(async () => { await result.current.markSeasonUnwatched(1, [1, 2]); });

    expect(updateProgress).toHaveBeenCalledWith('tv', DOCTOR_WHO, 0, 0);
  });
});

// BIN-954. `toHaveBeenCalledWith` matches the argument list EXACTLY, so every assertion
// in this file is also the pin on which calls carry the add-intent flag and which do not.
// Two carry it — the tick and markSeasonWatched, the two gestures that mean "I am watching
// this" — and the four un-tick / auto-advance calls must not, or un-ticking an episode
// would add the series the user is stepping away from.
describe('numbered seasons are unchanged (BIN-679 must not touch them)', () => {
  it('ticking a numbered episode still writes the marker', async () => {
    const { result } = renderHook(() => useEpisodeProgressWithSync(DOCTOR_WHO));
    await act(async () => { await result.current.markEpisodeWatched(4, 3, true); });

    expect(updateProgress).toHaveBeenCalledWith('tv', DOCTOR_WHO, 4, 3, { addIfMissing: true });
  });

  it('still auto-advances on a genuinely completed numbered season', async () => {
    base.progress = progressOf({ 4: { 1: true, 2: true } });
    const { result } = renderHook(() => useEpisodeProgressWithSync(DOCTOR_WHO));
    await act(async () => { await result.current.markEpisodeWatched(4, 3, true, 3); });

    expect(updateProgress).toHaveBeenNthCalledWith(1, 'tv', DOCTOR_WHO, 4, 3, { addIfMissing: true });
    // BIN-954: the follow-up carries NO flag — the call above has already written (and if
    // necessary created) the document, so this one is always an update. Handing it the
    // flag would re-run the whole add: a second TMDB fetch and a second analytics event.
    expect(updateProgress).toHaveBeenNthCalledWith(2, 'tv', DOCTOR_WHO, 5, 0);
  });

  it('un-ticking a numbered episode still falls back to the highest numbered one', async () => {
    base.progress = progressOf({ 0: { 13: true }, 2: { 1: true }, 3: { 1: true, 2: true } });
    const { result } = renderHook(() => useEpisodeProgressWithSync(DOCTOR_WHO));
    await act(async () => { await result.current.markEpisodeWatched(3, 2, false); });

    expect(updateProgress).toHaveBeenCalledWith('tv', DOCTOR_WHO, 3, 1);
  });

  it('markSeasonWatched on a numbered season still writes the marker', async () => {
    const { result } = renderHook(() => useEpisodeProgressWithSync(DOCTOR_WHO));
    await act(async () => { await result.current.markSeasonWatched(2, 13); });

    expect(updateProgress).toHaveBeenCalledWith('tv', DOCTOR_WHO, 2, 13, { addIfMissing: true });
  });
});

// BIN-954, acceptance criterion 6, asserted as ONE statement over the whole surface rather
// than left implicit in the per-gesture tests above. The negative half is the load-bearing
// one: an un-tick that carried the flag would add the series you are stepping away from.
describe('the add-intent flag reaches exactly the two watch gestures (BIN-954)', () => {
  it('the non-watch calls pass no options object at all', async () => {
    // Season 3 holds exactly one watched episode, so a single tick completes it (driving
    // the auto-advance) and a single un-tick empties it (driving the 0,0 reset).
    base.progress = progressOf({ 3: { 1: true } });
    const { result } = renderHook(() => useEpisodeProgressWithSync(DOCTOR_WHO));

    // a watch gesture, plus the auto-advance it triggers
    await act(async () => { await result.current.markEpisodeWatched(3, 1, true, 1); });
    // un-tick the only watched episode → the 0,0 reset
    await act(async () => { await result.current.markEpisodeWatched(3, 1, false); });
    // un-tick the whole season → the same reset by the other route
    await act(async () => { await result.current.markSeasonUnwatched(3, [1]); });

    // toHaveBeenNthCalledWith matches the argument list exactly, so a 4-argument
    // expectation FAILS if a 5th sneaks in. One of these four is the watch gesture.
    expect(updateProgress.mock.calls).toHaveLength(4);
    expect(updateProgress).toHaveBeenNthCalledWith(1, 'tv', DOCTOR_WHO, 3, 1, { addIfMissing: true });
    expect(updateProgress).toHaveBeenNthCalledWith(2, 'tv', DOCTOR_WHO, 4, 0);
    expect(updateProgress).toHaveBeenNthCalledWith(3, 'tv', DOCTOR_WHO, 0, 0);
    expect(updateProgress).toHaveBeenNthCalledWith(4, 'tv', DOCTOR_WHO, 0, 0);
    // Three of the hook's four non-watch call sites are driven here (auto-advance, the
    // un-tick reset, the season un-tick). The fourth — the un-tick that falls back to a
    // LOWER position instead of to 0,0 — is pinned in the same exact-argument form by
    // 'un-ticking a numbered episode still falls back to the highest numbered one' above.
  });

  it('the two watch gestures both pass it', async () => {
    const { result } = renderHook(() => useEpisodeProgressWithSync(DOCTOR_WHO));
    await act(async () => { await result.current.markEpisodeWatched(4, 3, true); });
    await act(async () => { await result.current.markSeasonWatched(2, 13); });

    expect(updateProgress.mock.calls).toHaveLength(2);
    expect(updateProgress).toHaveBeenNthCalledWith(1, 'tv', DOCTOR_WHO, 4, 3, { addIfMissing: true });
    expect(updateProgress).toHaveBeenNthCalledWith(2, 'tv', DOCTOR_WHO, 2, 13, { addIfMissing: true });
  });
});
