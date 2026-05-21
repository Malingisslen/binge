'use client';

import { ChevronRight } from 'lucide-react';
import SeasonEpisodePanel from './SeasonEpisodePanel';
import type { MaskBoundary } from '@/lib/groupProgress';

interface SeasonRowProps {
  name: string;
  episodeCount: number;
  watchedCount: number;
  expanded: boolean;
  tmdbId: number;
  seasonNumber: number;
  previousSeasons?: { season_number: number; episode_count: number }[];
  onToggle: () => void;
  isWatched: (season: number, episode: number) => boolean;
  markEpisodeWatched: (season: number, episode: number, watched: boolean, episodeCount?: number) => Promise<void>;
  markSeasonWatched: (season: number, episodeCount: number) => Promise<void>;
  maskBoundary?: MaskBoundary | null;
}

export default function SeasonRow({
  name, episodeCount, watchedCount, expanded, tmdbId, seasonNumber, previousSeasons,
  onToggle, isWatched, markEpisodeWatched, markSeasonWatched, maskBoundary,
}: SeasonRowProps) {
  const pct = episodeCount > 0 ? (watchedCount / episodeCount) * 100 : 0;
  const isDone = watchedCount >= episodeCount && episodeCount > 0;

  return (
    <div className="border-b border-rule-2 last:border-b-0">
      <div className="flex items-center justify-between py-[5px] text-sm">
        <div
          className="flex items-center gap-1 cursor-pointer flex-1 min-w-0"
          onClick={onToggle}
        >
          <ChevronRight
            size={12}
            className={`shrink-0 text-ink-3 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          />
          <span className="font-semibold text-ink-2">
            {name} <span className="font-normal text-ink-3 text-xs">({episodeCount} avs)</span>
          </span>
        </div>
        {episodeCount > 0 ? (
          <div className="flex items-center gap-[5px] flex-1 max-w-[180px] mx-4">
            <div className="flex-1 h-[3px] bg-rule rounded-full overflow-hidden">
              <div className="h-full bg-ink rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xxs text-ink-3">{watchedCount}/{episodeCount}</span>
          </div>
        ) : (
          <span className="text-xxs text-ink-3 mx-4">Kommande</span>
        )}
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
          previousSeasons={previousSeasons}
          isWatched={isWatched}
          markEpisodeWatched={markEpisodeWatched}
          markSeasonWatched={markSeasonWatched}
          maskBoundary={maskBoundary}
        />
      )}
    </div>
  );
}
