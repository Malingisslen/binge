'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useEpisodeProgress } from './useEpisodeProgress';
import { useWatchlist } from './useWatchlist';
import { highestWatchedPosition } from './useEpisodeProgressWithSync.helpers';

/**
 * Wraps useEpisodeProgress with automatic watchlist sync.
 * When episodes are marked watched, lastWatchedSeason/Episode
 * on the watchlist item is updated in parallel.
 */
export function useEpisodeProgressWithSync(tmdbId: number) {
  const episodeProgress = useEpisodeProgress(tmdbId);
  const { progress, markEpisodeWatched: markEpisode, markSeasonWatched: markSeason, markSeasonUnwatched: markSeasonUnwatchedBase } = episodeProgress;
  const { updateProgress } = useWatchlist();

  // T7: progress läses via ref istället för closure-dep. Två vinster:
  // (1) markEpisodeWatched byter inte identitet vid varje onSnapshot —
  //     memo:ade avsnittsrader slipper re-rendera för callback-identitet;
  // (2) sekventiella loopar ("Avmarkera alla") läser alltid senaste progress
  //     istället för det värde som rådde när loopen startade.
  // (uppdateras i effect — refs får inte skrivas under render; callbacken
  // läser refen först vid användar-interaktion, långt efter effekten.)
  const progressRef = useRef(progress);
  useEffect(() => { progressRef.current = progress; }, [progress]);

  const markEpisodeWatched = useCallback(async (season: number, episode: number, watched: boolean, episodeCount?: number) => {
    if (watched) {
      await Promise.all([
        markEpisode(season, episode, watched),
        updateProgress('tv', tmdbId, season, episode),
      ]);
      // Auto-advance: if this was the last episode of the season, point to next season
      if (episodeCount !== undefined && episode >= episodeCount) {
        await updateProgress('tv', tmdbId, season + 1, 0);
      }
    } else {
      await markEpisode(season, episode, watched);
      // Synka watchlist-progressen bakåt: utan detta fastnar
      // lastWatchedSeason/Episode på ett högre värde → fel sub-state (visar
      // "ikapp"/"avslutad" fast användaren just backade ett avsnitt). Räkna om
      // högsta kvarvarande sedda position ur episodeProgress (onSnapshot hinner
      // inte uppdatera lokal state före detta, så vi exkluderar avsnittet vi
      // just avmarkerade). Nollställ till 0,0 om inga avsnitt är sedda kvar.
      const highest = highestWatchedPosition(progressRef.current, { season, episode });
      if (highest) {
        await updateProgress('tv', tmdbId, highest.season, highest.episode);
      } else {
        await updateProgress('tv', tmdbId, 0, 0);
      }
    }
  }, [markEpisode, updateProgress, tmdbId]);

  const markSeasonWatched = useCallback(async (season: number, episodeCount: number) => {
    await Promise.all([
      markSeason(season, episodeCount),
      updateProgress('tv', tmdbId, season, episodeCount),
    ]);
  }, [markSeason, updateProgress, tmdbId]);

  // BIN-171: avmarkera en hel säsong. Den gamla "loopa markEpisodeWatched(false)"
  // satte lastWatched per avsnitt mot en STALE progressRef (onSnapshot hann inte
  // emellan), så lastWatched fastnade på ett avsnitt man just avmarkerade. Här:
  // avmarkera alla avsnitt, räkna sedan om högsta kvarvarande position EN gång
  // med hela säsongen exkluderad (0,0 om inget kvar i andra säsonger).
  // BIN-495: hela säsongen skrivs i EN Firestore-write (markSeasonUnwatchedBase)
  // istället för N parallella per-avsnitt-writes.
  const markSeasonUnwatched = useCallback(async (season: number, episodeNumbers: number[]) => {
    await markSeasonUnwatchedBase(season, episodeNumbers);
    const highest = highestWatchedPosition(progressRef.current, undefined, season);
    await updateProgress('tv', tmdbId, highest?.season ?? 0, highest?.episode ?? 0);
  }, [markSeasonUnwatchedBase, updateProgress, tmdbId]);

  return {
    ...episodeProgress,
    markEpisodeWatched,
    markSeasonWatched,
    markSeasonUnwatched,
  };
}
