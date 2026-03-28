'use client';

import { useState } from 'react';
import type { TMDBSeason } from '@/types';
import SeasonRow from './SeasonRow';

interface SeasonListProps {
  tmdbId: number;
  seasons: TMDBSeason[];
  isWatched: (season: number, episode: number) => boolean;
  markEpisodeWatched: (season: number, episode: number, watched: boolean, episodeCount?: number) => Promise<void>;
  markSeasonWatched: (season: number, episodeCount: number) => Promise<void>;
  getSeasonProgress: (season: number, episodeCount?: number) => { watched: number; total: number };
}

export default function SeasonList({
  tmdbId, seasons, isWatched, markEpisodeWatched, markSeasonWatched, getSeasonProgress,
}: SeasonListProps) {
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);

  const displaySeasons = seasons.filter(s => s.season_number > 0);

  const toggle = (seasonNumber: number) => {
    setExpandedSeason(prev => prev === seasonNumber ? null : seasonNumber);
  };

  return (
    <div className="px-3 py-1">
      {displaySeasons.map(season => {
        const progress = getSeasonProgress(season.season_number, season.episode_count);
        return (
          <SeasonRow
            key={season.id}
            name={season.name}
            episodeCount={season.episode_count}
            watchedCount={progress.watched}
            expanded={expandedSeason === season.season_number}
            tmdbId={tmdbId}
            seasonNumber={season.season_number}
            onToggle={() => toggle(season.season_number)}
            isWatched={isWatched}
            markEpisodeWatched={markEpisodeWatched}
            markSeasonWatched={markSeasonWatched}
          />
        );
      })}
    </div>
  );
}
