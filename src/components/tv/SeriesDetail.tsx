'use client';

import Link from 'next/link';
import { posterUrl } from '@/lib/tmdb/client';
import type { TMDBTVShow } from '@/types';
import RatingStars from '@/components/title/RatingStars';
import SeasonList from './SeasonList';
import { useWatchlist } from '@/hooks/useWatchlist';

interface SeriesDetailProps {
  show: TMDBTVShow;
}

export default function SeriesDetail({ show }: SeriesDetailProps) {
  const poster = posterUrl(show.poster_path, 'w154');
  const providers = show['watch/providers']?.results?.SE;
  const flatrate = providers?.flatrate ?? [];
  const { getItem, updateRating, removeItem } = useWatchlist();
  const watchlistItem = getItem(show.id);

  const statusLabel = show.status === 'Ended' ? 'Avslutad' :
    show.status === 'Returning Series' ? 'Pågår' :
    show.status === 'Canceled' ? 'Inställd' : show.status;

  const nextEp = show.next_episode_to_air;
  const genres = show.genres.map(g => g.name).join(', ');
  const yearStart = show.first_air_date?.substring(0, 4) ?? '—';
  const yearEnd = show.status === 'Ended' ? show.last_air_date?.substring(0, 4) : '';

  return (
    <div className="bg-[#f5f2ec] border-t border-[#e5e0d8]">
      <div className="flex gap-[10px] px-3 py-[10px] border-b border-[#e5e0d8]">
        {poster ? (
          <img src={poster} alt={show.name} className="w-[40px] h-[60px] rounded-sm object-cover shrink-0" />
        ) : (
          <div className="w-[40px] h-[60px] rounded-sm bg-[#d5d0c5] shrink-0" />
        )}
        <div className="flex-1 text-sm">
          <div className="font-bold text-md">{show.name}</div>
          <div className="text-text-muted text-xs">
            {flatrate.length > 0 && <>{flatrate.map(p => p.provider_name).join(', ')} · </>}
            {genres} · {yearStart}{yearEnd ? `–${yearEnd}` : '-'} · {statusLabel}
          </div>
          <RatingStars
            rating={watchlistItem?.rating ?? null}
            onChange={r => watchlistItem && updateRating(show.id, r)}
            readonly={!watchlistItem}
          />
          {nextEp && (
            <div className="mt-1 text-text-secondary text-sm">
              Nästa: S{nextEp.season_number}E{nextEp.episode_number} ({nextEp.air_date})
            </div>
          )}
          <div className="flex gap-1 mt-[6px]">
            {nextEp && (
              <button className="px-[10px] py-[3px] border border-accent rounded-sm text-xs font-[inherit] cursor-pointer bg-accent text-white">
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
              <button
                onClick={() => removeItem(show.id)}
                className="px-[10px] py-[3px] border border-border-main rounded-sm text-xs font-[inherit] cursor-pointer bg-surface text-text-secondary hover:bg-surface-hover"
              >
                Sluta följa
              </button>
            )}
          </div>
        </div>
      </div>
      <SeasonList
        tmdbId={show.id}
        seasons={show.seasons}
        onSeasonClick={() => {}}
      />
    </div>
  );
}
