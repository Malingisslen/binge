'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useEpisodeProgress } from './useEpisodeProgress';
import { useWatchlist } from './useWatchlist';
import { highestWatchedPosition, isSeasonFullyWatched } from './useEpisodeProgressWithSync.helpers';

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

  // BIN-679: säsong 0 är specials, och watchlist-markören
  // (lastWatchedSeason/Episode) har ingen position som betyder "sett ett
  // specialavsnitt" — den räknar numrerade säsonger. Så en special-bockning
  // skriver ENBART episodeProgress och rör aldrig markören.
  //
  // Det stänger också gruppsynken vid källan: syncProgressToGroups anropas inuti
  // WatchlistContext.updateProgress och ingen annanstans, så ett special kan inte
  // nå någon annan medlems spoilergräns. Det värsta felläget här var aldrig en
  // felaktig räknare — det var computeMaskBoundary som matar spoilerskyddet i
  // Tillsammans för ANDRA (#27:s kritik 2026-08-07).
  //
  // Motparten till den här vakten sitter i highestWatchedPosition, som hoppar över
  // säsong 0 när markören räknas om bakåt. Utan båda läcker specials in i markören
  // via avmarkeringsvägen i stället för bockningsvägen.
  const markEpisodeWatched = useCallback(async (season: number, episode: number, watched: boolean, episodeCount?: number) => {
    if (season === 0) {
      await markEpisode(season, episode, watched);
      return;
    }
    if (watched) {
      await Promise.all([
        markEpisode(season, episode, watched),
        // BIN-954: one of exactly two watch-intent calls in this file (the other is
        // markSeasonWatched). Ticking an episode of a series you don't follow is you
        // saying you watch it, so updateProgress may ADD it with a full payload instead
        // of writing the identity-less fragment it used to. The four other calls below
        // deliberately pass nothing.
        updateProgress('tv', tmdbId, season, episode, { addIfMissing: true }),
      ]);
      // Auto-advance: if this was the last episode of the season, point to next season.
      //
      // BIN-588: ticking the finale is NOT proof the season is done. Someone who
      // opens a season and ticks only the last episode (or jumps ahead) used to
      // land on säsong+1, avsnitt 0 — a pointer that says "hela säsongen sedd",
      // which then reads as ikapp/avslutad and hides the episodes they never
      // watched from Fortsätt titta and kalendern. So gate the jump on the
      // season actually being complete, counted out of episodeProgress the same
      // way the unwatch branch below recomputes from it (progressRef, plus the
      // episode we just wrote — onSnapshot has not landed yet).
      //
      // Deliberately still ALSO requires the finale to be the episode just
      // ticked: that keeps this a strict narrowing of the old rule. Completing a
      // season out of order (finale first, then filling the gaps) never
      // auto-advanced before and does not start doing so here.
      if (
        episodeCount !== undefined
        && episode >= episodeCount
        && isSeasonFullyWatched(progressRef.current, season, episodeCount, episode)
      ) {
        // BIN-954: no `addIfMissing` — the await above has already written the document,
        // adding it first if it was missing, so this call is an update. The snapshot has
        // not landed yet, so `findItem` inside updateProgress is still empty; what keeps
        // this from being read as "absent" is the session ref updateProgress marks when IT
        // adds. Passing the flag here instead would re-run the whole add.
        // The one case where the document is still missing: the add above failed on its
        // TMDB fetch. Then this call writes nothing either — which is the right outcome,
        // since a pointer to season+1 on a series that was never added is the fragment
        // this ticket exists to stop.
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
    // BIN-679, samma vakt: se markEpisodeWatched ovan.
    if (season === 0) {
      await markSeason(season, episodeCount);
      return;
    }
    await Promise.all([
      markSeason(season, episodeCount),
      // BIN-954: the second and last watch-intent call — see markEpisodeWatched above.
      updateProgress('tv', tmdbId, season, episodeCount, { addIfMissing: true }),
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
    // BIN-679, samma vakt: se markEpisodeWatched ovan.
    if (season === 0) {
      await markSeasonUnwatchedBase(season, episodeNumbers);
      return;
    }
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
