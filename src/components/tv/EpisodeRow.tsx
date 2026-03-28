'use client';

import type { TMDBEpisode } from '@/types';
import { stillUrl } from '@/lib/tmdb/client';

interface EpisodeRowProps {
  episode: TMDBEpisode;
  watched: boolean;
  onToggle: (watched: boolean) => void;
}

export default function EpisodeRow({ episode, watched, onToggle }: EpisodeRowProps) {
  const still = stillUrl(episode.still_path, 'w185');

  return (
    <div className="flex items-center gap-2 py-[5px] border-b border-border-table last:border-b-0">
      <input
        type="checkbox"
        checked={watched}
        onChange={e => onToggle(e.target.checked)}
        className="shrink-0 accent-accent w-[14px] h-[14px] cursor-pointer"
      />
      {still ? (
        <img src={still} alt="" className="w-[60px] h-[34px] rounded-sm object-cover shrink-0" />
      ) : (
        <div className="w-[60px] h-[34px] rounded-sm bg-[#ddd8d0] shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-base font-semibold truncate">
          {episode.episode_number}. {episode.name}
        </div>
        <div className="text-xs text-text-muted">
          {episode.air_date ?? '—'}
          {episode.runtime ? ` · ${episode.runtime} min` : ''}
        </div>
        {episode.overview && (
          <div className="text-xs text-text-muted mt-[2px] line-clamp-2">{episode.overview}</div>
        )}
      </div>
    </div>
  );
}
