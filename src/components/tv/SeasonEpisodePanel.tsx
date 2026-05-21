'use client';

import { useTVSeason } from '@/hooks/useTMDB';
import EpisodeRow from './EpisodeRow';
import { isEpisodeMasked, type MaskBoundary } from '@/lib/groupProgress';

interface SeasonEpisodePanelProps {
  tmdbId: number;
  seasonNumber: number;
  previousSeasons?: { season_number: number; episode_count: number }[];
  isWatched: (season: number, episode: number) => boolean;
  markEpisodeWatched: (season: number, episode: number, watched: boolean, episodeCount?: number) => Promise<void>;
  markSeasonWatched: (season: number, episodeCount: number) => Promise<void>;
  maskBoundary?: MaskBoundary | null;
}

export default function SeasonEpisodePanel({
  tmdbId, seasonNumber, previousSeasons, isWatched, markEpisodeWatched, markSeasonWatched, maskBoundary,
}: SeasonEpisodePanelProps) {
  const { data: season, isLoading } = useTVSeason(tmdbId, seasonNumber);

  if (isLoading) {
    return (
      <div className="bg-bg-2 border-t border-rule-2 px-4 py-2 text-xs text-ink-3">
        Laddar...
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

  return (
    <div className="bg-bg-2 border-t border-rule-2">
      <div className="px-4 pt-2 pb-2 flex gap-2">
        {!allWatched && (
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
            <EpisodeRow
              key={ep.id}
              episode={ep}
              seasonNumber={seasonNumber}
              watched={isWatched(seasonNumber, ep.episode_number)}
              spoilerMasked={isEpisodeMasked(maskBoundary ?? null, seasonNumber, ep.episode_number)}
              onToggle={watched => markEpisodeWatched(seasonNumber, ep.episode_number, watched, episodes.length)}
              onMarkUpTo={async () => {
                if (previousSeasons) {
                  for (const ps of previousSeasons) {
                    if (ps.season_number > 0 && ps.season_number < seasonNumber) {
                      await markSeasonWatched(ps.season_number, ps.episode_count);
                    }
                  }
                }
                await markSeasonWatched(seasonNumber, ep.episode_number);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
