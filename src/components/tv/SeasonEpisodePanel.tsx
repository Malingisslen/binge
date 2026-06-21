'use client';

import { memo, useCallback } from 'react';
import { useTVSeason } from '@/hooks/useTMDB';
import EpisodeRow from './EpisodeRow';
import { LoadingView } from '@/components/ui/LoadingView';
import { isEpisodeMasked, type MaskBoundary } from '@/lib/groupProgress';
import { countAiredEpisodes } from '@/lib/episodeLabel';
import { todayIso } from '@/lib/utils';
import type { TMDBEpisode } from '@/types';

interface SeasonEpisodePanelProps {
  tmdbId: number;
  seasonNumber: number;
  previousSeasons?: { season_number: number; episode_count: number }[];
  isWatched: (season: number, episode: number) => boolean;
  markEpisodeWatched: (season: number, episode: number, watched: boolean, episodeCount?: number) => Promise<void>;
  markSeasonWatched: (season: number, episodeCount: number) => Promise<void>;
  maskBoundary?: MaskBoundary | null;
}

// T7: per-rad-wrapper med stabila callbacks. Tidigare byggdes onToggle/
// onMarkUpTo som inline-closures i .map() — ny identitet varje render, vilket
// gjorde memo:n på EpisodeRow verkningslös och re-renderade hela avsnitts-
// listan vid varje progress-onSnapshot. Nu re-renderar bara rader vars
// watched/masked-state faktiskt ändrats.
const PanelEpisodeRow = memo(function PanelEpisodeRow({
  episode, seasonNumber, tmdbId, episodeCount, watched, spoilerMasked, markEpisodeWatched, markUpTo,
}: {
  episode: TMDBEpisode;
  seasonNumber: number;
  tmdbId: number;
  episodeCount: number;
  watched: boolean;
  spoilerMasked: boolean;
  markEpisodeWatched: (season: number, episode: number, watched: boolean, episodeCount?: number) => Promise<void>;
  markUpTo: (episodeNumber: number) => Promise<void>;
}) {
  const handleToggle = useCallback(
    (w: boolean) => { void markEpisodeWatched(seasonNumber, episode.episode_number, w, episodeCount); },
    [markEpisodeWatched, seasonNumber, episode.episode_number, episodeCount]
  );
  const handleMarkUpTo = useCallback(
    () => { void markUpTo(episode.episode_number); },
    [markUpTo, episode.episode_number]
  );
  return (
    <EpisodeRow
      episode={episode}
      seasonNumber={seasonNumber}
      tmdbId={tmdbId}
      watched={watched}
      spoilerMasked={spoilerMasked}
      onToggle={handleToggle}
      onMarkUpTo={handleMarkUpTo}
    />
  );
});

export default function SeasonEpisodePanel({
  tmdbId, seasonNumber, previousSeasons, isWatched, markEpisodeWatched, markSeasonWatched, maskBoundary,
}: SeasonEpisodePanelProps) {
  const { data: season, isLoading } = useTVSeason(tmdbId, seasonNumber);

  // T7: hoistad "markera hit"-logik — en stabil funktion för hela panelen
  // istället för en ny closure per rad och render.
  const markUpTo = useCallback(async (episodeNumber: number) => {
    if (previousSeasons) {
      for (const ps of previousSeasons) {
        if (ps.season_number > 0 && ps.season_number < seasonNumber) {
          await markSeasonWatched(ps.season_number, ps.episode_count);
        }
      }
    }
    await markSeasonWatched(seasonNumber, episodeNumber);
  }, [previousSeasons, seasonNumber, markSeasonWatched]);

  if (isLoading) {
    return (
      <div className="bg-bg-2 border-t border-rule-2 px-4">
        <LoadingView label="Laddar avsnitt…" />
      </div>
    );
  }

  if (!season?.episodes?.length) {
    return (
      <div className="bg-bg-2 border-t border-rule-2 px-4 py-2 text-xs text-ink-3">
        Inga avsnitt hittades.
      </div>
    );
  }

  const episodes = season.episodes;
  const watchedCount = episodes.filter(ep => isWatched(seasonNumber, ep.episode_number)).length;
  const allWatched = watchedCount >= episodes.length;
  // T3: visa inte "Markera alla sedda" för säsonger där inget avsnitt sänts än.
  const airedCount = countAiredEpisodes(episodes, todayIso());

  return (
    <div className="bg-bg-2 border-t border-rule-2">
      <div className="px-4 pt-2 pb-2 flex gap-2">
        {!allWatched && airedCount > 0 && (
          <button
            onClick={() => markSeasonWatched(seasonNumber, episodes.length)}
            className="px-[10px] py-[3px] rounded-sm text-xxs font-semibold border-none cursor-pointer bg-acc-deep text-white"
          >
            Markera alla sedda
          </button>
        )}
        {watchedCount > 0 && (
          <button
            onClick={async () => {
              for (const ep of episodes) {
                if (isWatched(seasonNumber, ep.episode_number)) {
                  await markEpisodeWatched(seasonNumber, ep.episode_number, false);
                }
              }
            }}
            className="px-[10px] py-[3px] rounded-sm text-xxs font-semibold border border-rule cursor-pointer bg-surface text-ink-2"
          >
            Avmarkera alla
          </button>
        )}
      </div>
      <div className="px-4 pb-3">
        <div className="eps">
          {episodes.map(ep => (
            <PanelEpisodeRow
              key={ep.id}
              episode={ep}
              seasonNumber={seasonNumber}
              tmdbId={tmdbId}
              episodeCount={episodes.length}
              watched={isWatched(seasonNumber, ep.episode_number)}
              spoilerMasked={isEpisodeMasked(maskBoundary ?? null, seasonNumber, ep.episode_number)}
              markEpisodeWatched={markEpisodeWatched}
              markUpTo={markUpTo}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
