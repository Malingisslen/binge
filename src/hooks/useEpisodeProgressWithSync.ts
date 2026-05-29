'use client';

import { useCallback } from 'react';
import { useEpisodeProgress } from './useEpisodeProgress';
import { useWatchlist } from './useWatchlist';
import type { EpisodeProgress } from '@/types';

/**
 * Räknar fram högsta sedda position (säsong/avsnitt) ur en episodeProgress-map,
 * med möjlighet att exkludera en (season, episode) som just markerats osedd.
 * Returnerar null om inga avsnitt är sedda kvar. Specials (säsong 0) räknas med
 * men förlorar mot vilken säsong >= 1 som helst.
 */
function highestWatchedPosition(
  progress: EpisodeProgress | null,
  exclude?: { season: number; episode: number },
): { season: number; episode: number } | null {
  if (!progress?.seasons) return null;
  let best: { season: number; episode: number } | null = null;
  for (const [seasonKey, seasonData] of Object.entries(progress.seasons)) {
    if (!seasonData || typeof seasonData !== 'object') continue;
    const season = Number(seasonKey);
    if (!Number.isFinite(season)) continue;
    for (const [episodeKey, ep] of Object.entries(seasonData)) {
      if (!ep || typeof ep !== 'object' || !ep.watched) continue;
      const episode = Number(episodeKey);
      if (!Number.isFinite(episode)) continue;
      if (exclude && exclude.season === season && exclude.episode === episode) continue;
      if (!best || season > best.season || (season === best.season && episode > best.episode)) {
        best = { season, episode };
      }
    }
  }
  return best;
}

/**
 * Wraps useEpisodeProgress with automatic watchlist sync.
 * When episodes are marked watched, lastWatchedSeason/Episode
 * on the watchlist item is updated in parallel.
 */
export function useEpisodeProgressWithSync(tmdbId: number) {
  const episodeProgress = useEpisodeProgress(tmdbId);
  const { progress, markEpisodeWatched: markEpisode, markSeasonWatched: markSeason } = episodeProgress;
  const { updateProgress } = useWatchlist();

  const markEpisodeWatched = useCallback(async (season: number, episode: number, watched: boolean, episodeCount?: number) => {
    if (watched) {
      await Promise.all([
        markEpisode(season, episode, watched),
        updateProgress(tmdbId, season, episode),
      ]);
      // Auto-advance: if this was the last episode of the season, point to next season
      if (episodeCount !== undefined && episode >= episodeCount) {
        await updateProgress(tmdbId, season + 1, 0);
      }
    } else {
      await markEpisode(season, episode, watched);
      // Synka watchlist-progressen bakåt: utan detta fastnar
      // lastWatchedSeason/Episode på ett högre värde → fel sub-state (visar
      // "ikapp"/"avslutad" fast användaren just backade ett avsnitt). Räkna om
      // högsta kvarvarande sedda position ur episodeProgress (onSnapshot hinner
      // inte uppdatera lokal state före detta, så vi exkluderar avsnittet vi
      // just avmarkerade). Nollställ till 0,0 om inga avsnitt är sedda kvar.
      const highest = highestWatchedPosition(progress, { season, episode });
      if (highest) {
        await updateProgress(tmdbId, highest.season, highest.episode);
      } else {
        await updateProgress(tmdbId, 0, 0);
      }
    }
  }, [markEpisode, updateProgress, tmdbId, progress]);

  const markSeasonWatched = useCallback(async (season: number, episodeCount: number) => {
    await Promise.all([
      markSeason(season, episodeCount),
      updateProgress(tmdbId, season, episodeCount),
    ]);
  }, [markSeason, updateProgress, tmdbId]);

  return {
    ...episodeProgress,
    markEpisodeWatched,
    markSeasonWatched,
  };
}
