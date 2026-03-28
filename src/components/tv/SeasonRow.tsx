'use client';

import { ChevronRight } from 'lucide-react';
import SeasonEpisodePanel from './SeasonEpisodePanel';

interface SeasonRowProps {
  name: string;
  episodeCount: number;
  watchedCount: number;
  expanded: boolean;
  tmdbId: number;
  seasonNumber: number;
  onToggle: () => void;
  isWatched: (season: number, episode: number) => boolean;
  markEpisodeWatched: (season: number, episode: number, watched: boolean) => Promise<void>;
  markSeasonWatched: (season: number, episodeCount: number) => Promise<void>;
}

export default function SeasonRow({
  name, episodeCount, watchedCount, expanded, tmdbId, seasonNumber,
  onToggle, isWatched, markEpisodeWatched, markSeasonWatched,
}: SeasonRowProps) {
  const pct = episodeCount > 0 ? (watchedCount / episodeCount) * 100 : 0;
  const isDone = watchedCount >= episodeCount && episodeCount > 0;

  return (
    <div className="border-b border-[#e8e4dc] last:border-b-0">
      <div className="flex items-center justify-between py-[5px] text-sm">
        <div
          className="flex items-center gap-1 cursor-pointer flex-1 min-w-0"
          onClick={onToggle}
        >
          <ChevronRight
            size={12}
            className={`shrink-0 text-text-muted transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          />
          <span className="font-semibold text-text-secondary">
            {name} <span className="font-normal text-text-muted text-xs">({episodeCount} avs)</span>
          </span>
        </div>
        <div className="flex items-center gap-[5px] flex-1 max-w-[180px] mx-4">
          <div className="flex-1 h-[3px] bg-[#e5e0d8] rounded-[1px] overflow-hidden">
            <div className="h-full bg-accent rounded-[1px]" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xxs text-[#bbb]">{watchedCount}/{episodeCount}</span>
        </div>
        {isDone && (
          <span className="px-[10px] py-[2px] rounded-sm text-xxs font-semibold bg-season-done text-white">
            Sedd
          </span>
        )}
      </div>
      {expanded && (
        <SeasonEpisodePanel
          tmdbId={tmdbId}
          seasonNumber={seasonNumber}
          isWatched={isWatched}
          markEpisodeWatched={markEpisodeWatched}
          markSeasonWatched={markSeasonWatched}
        />
      )}
    </div>
  );
}
