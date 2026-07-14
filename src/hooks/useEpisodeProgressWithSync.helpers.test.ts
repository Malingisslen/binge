import { describe, it, expect } from 'vitest';
import type { EpisodeProgress } from '@/types';
import { highestWatchedPosition } from './useEpisodeProgressWithSync.helpers';

/** Build an EpisodeProgress from a { season: { episode: watched } } shorthand. */
function progress(spec: Record<number, Record<number, boolean>>): EpisodeProgress {
  const seasons: EpisodeProgress['seasons'] = {};
  for (const [season, eps] of Object.entries(spec)) {
    seasons[season] = {};
    for (const [ep, watched] of Object.entries(eps)) {
      seasons[season][ep] = { watched, watchedAt: watched ? new Date('2026-01-01') : null };
    }
  }
  return { tmdbId: 1, seasons };
}

describe('highestWatchedPosition', () => {
  it('returns null for null progress', () => {
    expect(highestWatchedPosition(null)).toBeNull();
  });

  it('returns null when no episodes are watched', () => {
    expect(highestWatchedPosition(progress({ 1: { 1: false, 2: false } }))).toBeNull();
  });

  it('picks the highest season, then highest episode within it', () => {
    const p = progress({ 1: { 1: true, 2: true }, 2: { 1: true, 2: true, 3: false } });
    expect(highestWatchedPosition(p)).toEqual({ season: 2, episode: 2 });
  });

  it('treats specials (season 0) as losing to any season >= 1', () => {
    const p = progress({ 0: { 1: true, 2: true }, 1: { 1: true } });
    expect(highestWatchedPosition(p)).toEqual({ season: 1, episode: 1 });
  });

  it('returns a special only when no numbered season has a watched episode', () => {
    const p = progress({ 0: { 1: true, 2: true }, 1: { 1: false } });
    expect(highestWatchedPosition(p)).toEqual({ season: 0, episode: 2 });
  });

  it('excludes a single just-unmarked episode', () => {
    const p = progress({ 1: { 1: true, 2: true, 3: true } });
    // pretend episode 3 was just unmarked but onSnapshot has not landed yet
    expect(highestWatchedPosition(p, { season: 1, episode: 3 })).toEqual({ season: 1, episode: 2 });
  });

  // --- BIN-495 season-exclusion recompute (the behaviourally-risky path) ---

  it('excludeSeason drops the whole season and lands on the highest remaining in other seasons', () => {
    const p = progress({ 1: { 1: true, 2: true }, 2: { 1: true, 2: true } });
    // "Avmarkera alla" for season 2 → recompute must ignore ALL of season 2
    expect(highestWatchedPosition(p, undefined, 2)).toEqual({ season: 1, episode: 2 });
  });

  it('excludeSeason returns null when nothing remains watched in other seasons', () => {
    const p = progress({ 2: { 1: true, 2: true } });
    // unmarking the only watched season leaves nothing → caller maps null to 0,0
    expect(highestWatchedPosition(p, undefined, 2)).toBeNull();
  });

  it('excludeSeason ignores the excluded season even when it holds the highest position', () => {
    const p = progress({ 1: { 1: true }, 3: { 5: true } });
    expect(highestWatchedPosition(p, undefined, 3)).toEqual({ season: 1, episode: 1 });
  });

  it('ignores a malformed (non-numeric) season key', () => {
    const p = progress({ 1: { 1: true } });
    (p.seasons as Record<string, unknown>)['bad'] = { x: { watched: true, watchedAt: null } };
    expect(highestWatchedPosition(p)).toEqual({ season: 1, episode: 1 });
  });

  it('ignores a malformed (non-numeric) episode key inside a valid season', () => {
    // Only watched entry has a non-numeric episode key → the episode-finiteness
    // guard must skip it and return null; without the guard this would surface a
    // { season: 1, episode: NaN } and silently corrupt the lastWatched pointer.
    const p: EpisodeProgress = { tmdbId: 1, seasons: { 1: { bad: { watched: true, watchedAt: null } } } };
    expect(highestWatchedPosition(p)).toBeNull();
  });
});
