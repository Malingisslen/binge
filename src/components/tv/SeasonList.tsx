'use client';

import type { TMDBSeason } from '@/types';
import SeasonRow from './SeasonRow';
import { useEpisodeProgress } from '@/hooks/useEpisodeProgress';

interface SeasonListProps {
  tmdbId: number;
  seasons: TMDBSeason[];
  onSeasonClick: (seasonNumber: number) => void;
}

export default function SeasonList({ tmdbId, seasons, onSeasonClick }: SeasonListProps) {
  const { getSeasonProgress, markSeasonWatched } = useEpisodeProgress(tmdbId);

  // Filter out specials (season 0) by default
  const displaySeasons = seasons.filter(s => s.season_number > 0);

  return (
    <div className="px-3 py-1">
      {displaySeasons.map(season => {
        const progress = getSeasonProgress(season.season_number);
        return (
          <SeasonRow
            key={season.id}
            name={season.name}
            episodeCount={season.episode_count}
            watchedCount={progress.watched}
            onMarkWatched={() => markSeasonWatched(season.season_number, season.episode_count)}
            onContinue={() => onSeasonClick(season.season_number)}
          />
        );
      })}
    </div>
  );
}
