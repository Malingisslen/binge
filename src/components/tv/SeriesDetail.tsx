'use client';

import { useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { posterUrl } from '@/lib/tmdb/client';
import type { TMDBTVShow } from '@/types';
import RatingStars from '@/components/title/RatingStars';
import NotesTextarea from '@/components/title/NotesTextarea';
import SeasonList from './SeasonList';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useEpisodeProgressWithSync } from '@/hooks/useEpisodeProgressWithSync';
import { tvShowStatusLabel } from '@/lib/watchStatus';

interface SeriesDetailProps {
  show: TMDBTVShow;
  onClose?: () => void;
}

export default function SeriesDetail({ show, onClose }: SeriesDetailProps) {
  const poster = posterUrl(show.poster_path, 'w154');
  const providers = show['watch/providers']?.results?.SE;
  const flatrate = providers?.flatrate ?? [];
  const { getItem, updateRating, updateNotes, removeItem } = useWatchlist();
  const { isWatched, markEpisodeWatched, markSeasonWatched, getSeasonProgress, getTotalProgress } = useEpisodeProgressWithSync(show.id);
  const watchlistItem = getItem(show.id);

  const [showNotes, setShowNotes] = useState(false);

  const nextEp = show.next_episode_to_air;
  const genres = show.genres.map(g => g.name).join(', ');
  const yearStart = show.first_air_date?.substring(0, 4) ?? '—';
  const yearEnd = show.status === 'Ended' ? show.last_air_date?.substring(0, 4) : '';

  const handleMarkNextEpisode = async () => {
    if (!nextEp) return;
    await markEpisodeWatched(nextEp.season_number, nextEp.episode_number, true);
  };

  return (
    <div className="bg-[#f5f2ec] border-t border-[#e5e0d8]">
      <div className="flex gap-[10px] px-3 py-[10px] border-b border-[#e5e0d8] relative">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-[6px] right-[6px] text-text-muted hover:text-text-primary bg-transparent border-none cursor-pointer p-0"
          >
            <X size={14} />
          </button>
        )}
        {poster ? (
          <img src={poster} alt={show.name} className="w-[40px] h-[60px] rounded-sm object-cover shrink-0" loading="lazy" decoding="async" width={40} height={60} />
        ) : (
          <div className="w-[40px] h-[60px] rounded-sm bg-[#d5d0c5] shrink-0" />
        )}
        <div className="flex-1 text-sm">
          <div className="font-bold text-md">{show.name}</div>
          <div className="text-text-muted text-xs">
            {flatrate.length > 0 && <>{flatrate.map(p => p.provider_name).join(', ')} · </>}
            {genres} · {yearStart}{yearEnd ? `–${yearEnd}` : '-'} · {tvShowStatusLabel(show.status)}
          </div>
          <RatingStars
            rating={watchlistItem?.rating ?? null}
            onChange={r => watchlistItem && updateRating(show.id, r)}
            readonly={!watchlistItem}
          />
          {show.number_of_episodes > 0 && (
            <div className="text-xs text-text-muted mt-[2px]">
              {getTotalProgress()}/{show.number_of_episodes} avsnitt sedda
            </div>
          )}
          {nextEp && (
            <div className="mt-1 text-text-secondary text-sm">
              Nästa: S{nextEp.season_number}E{nextEp.episode_number} ({nextEp.air_date})
            </div>
          )}
          <div className="flex gap-1 mt-[6px]">
            {nextEp && (
              <button
                onClick={handleMarkNextEpisode}
                className="px-[10px] py-[3px] border border-accent rounded-sm text-xs font-[inherit] cursor-pointer bg-accent text-white"
              >
                Markera S{nextEp.season_number}E{nextEp.episode_number} sedd
              </button>
            )}
            <Link
              href={`/tv/${show.id}`}
              className="px-[10px] py-[3px] border border-border-main rounded-sm text-xs font-[inherit] cursor-pointer bg-surface text-text-secondary no-underline hover:bg-surface-hover"
            >
              Detaljer
            </Link>
            {watchlistItem && (
              <>
                <button
                  onClick={() => setShowNotes(prev => !prev)}
                  className={`px-[10px] py-[3px] border border-border-main rounded-sm text-xs font-[inherit] cursor-pointer ${
                    showNotes ? 'bg-accent text-white border-accent' : 'bg-surface text-text-secondary hover:bg-surface-hover'
                  }`}
                >
                  Anteckning
                </button>
                <button
                  onClick={() => removeItem(show.id)}
                  className="px-[10px] py-[3px] border border-border-main rounded-sm text-xs font-[inherit] cursor-pointer bg-surface text-text-secondary hover:bg-surface-hover"
                >
                  Sluta följa
                </button>
              </>
            )}
          </div>
          {showNotes && watchlistItem && (
            <NotesTextarea
              value={watchlistItem.notes}
              onChange={notes => updateNotes(show.id, notes)}
              className="mt-[6px] w-full px-2 py-1 text-xs border border-border-main rounded-sm bg-surface resize-none font-[inherit] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          )}
        </div>
      </div>
      <SeasonList
        tmdbId={show.id}
        seasons={show.seasons}
        isWatched={isWatched}
        markEpisodeWatched={markEpisodeWatched}
        markSeasonWatched={markSeasonWatched}
        getSeasonProgress={getSeasonProgress}
      />
    </div>
  );
}
