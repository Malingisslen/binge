'use client';

import { useCallback } from 'react';
import { useEpisodeProgress } from './useEpisodeProgress';
import { useWatchlist } from './useWatchlist';

/**
 * Wraps useEpisodeProgress with automatic watchlist sync.
 * When episodes are marked watched, lastWatchedSeason/Episode
 * on the watchlist item is updated in parallel.
 */
export function useEpisodeProgressWithSync(tmdbId: number) {
  const episodeProgress = useEpisodeProgress(tmdbId);
  const { updateProgress } = useWatchlist();

  const markEpisodeWatched = useCallback(async (season: number, episode: number, watched: boolean, episodeCount?: number) => {
    if (watched) {
      await Promise.all([
        episodeProgress.markEpisodeWatched(season, episode, watched),
        updateProgress(tmdbId, season, episode),
      ]);
      // Auto-advance: if this was the last episode of the season, point to next season
      if (episodeCount !== undefined && episode >= episodeCount) {
        await updateProgress(tmdbId, season + 1, 0);
      }
    } else {
      await episodeProgress.markEpisodeWatched(season, episode, watched);
    }
  }, [episodeProgress.markEpisodeWatched, updateProgress, tmdbId]);

  const markSeasonWatched = useCallback(async (season: number, episodeCount: number) => {
    await Promise.all([
      episodeProgress.markSeasonWatched(season, episodeCount),
      updateProgress(tmdbId, season, episodeCount),
    ]);
  }, [episodeProgress.markSeasonWatched, updateProgress, tmdbId]);

  return {
    ...episodeProgress,
    markEpisodeWatched,
    markSeasonWatched,
  };
}
