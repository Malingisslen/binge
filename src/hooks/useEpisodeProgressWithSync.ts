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

  const markEpisodeWatched = useCallback(async (season: number, episode: number, watched: boolean) => {
    if (watched) {
      await Promise.all([
        episodeProgress.markEpisodeWatched(season, episode, watched),
        updateProgress(tmdbId, season, episode),
      ]);
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
