'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Film, Tv } from 'lucide-react';
import { posterUrl } from '@/lib/tmdb/client';
import type { TMDBSearchResult } from '@/types';
import { getDisplayTitle, getReleaseYear } from '@/lib/tmdb/client';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { getProvider, canonicalProviderId } from '@/lib/tmdb/providers';
import type { TMDBProvider, MediaType } from '@/types';
import QuickAddButton from './QuickAddButton';
import NotInterestedButton from './NotInterestedButton';

const MAX_BADGES = 3;

interface TitleCardProps {
  item: TMDBSearchResult;
  providers?: TMDBProvider[];
  showNotInterested?: boolean;
}

export default function TitleCard({ item, providers, showNotInterested }: TitleCardProps) {
  const { user } = useAuth();
  const { getItem } = useWatchlist();
  const href = item.media_type === 'movie' ? `/movie/${item.id}/` : `/tv/${item.id}/`;
  const title = getDisplayTitle(item);
  const year = getReleaseYear(item);
  const poster = posterUrl(item.poster_path, 'w342');
  const myProviders = user?.myProviders ?? [];
  const isTrackable = item.media_type === 'movie' || item.media_type === 'tv';
  const isTracked = isTrackable && !!getItem(item.id);
  const Icon = item.media_type === 'tv' ? Tv : Film;
  const [imgError, setImgError] = useState(false);

  const visibleBadges = providers?.slice(0, MAX_BADGES) ?? [];
  const extraCount = (providers?.length ?? 0) - MAX_BADGES;

  return (
    <div className="group relative">
      <Link href={href} className="no-underline text-text-primary">
        <div className={`aspect-[2/3] bg-[#ddd8d0] rounded-sm mb-[3px] relative overflow-hidden ${
          isTracked ? 'ring-2 ring-accent' : ''
        }`}>
          {poster && !imgError ? (
            <img src={poster} alt={title} className="w-full h-full object-cover transition-opacity duration-300" loading="lazy" onError={() => setImgError(true)} />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-2 gap-1">
              <Icon size={20} className="text-text-muted opacity-40" />
              <span className="text-[10px] text-text-muted text-center line-clamp-3 leading-tight">{title}</span>
            </div>
          )}
          {visibleBadges.length > 0 && (
            <div className="absolute bottom-[2px] left-[2px] flex gap-[1px]">
              {visibleBadges.map(p => {
                const mapped = getProvider(p.provider_id);
                const isMine = myProviders.includes(canonicalProviderId(p.provider_id));
                return (
                  <span
                    key={p.provider_id}
                    className={`text-[7px] px-[3px] py-[1px] rounded-[1px] ${
                      isMine
                        ? 'bg-accent text-white'
                        : 'bg-black/65 text-[#ddd]'
                    }`}
                  >
                    {mapped?.shortName ?? p.provider_name}
                  </span>
                );
              })}
              {extraCount > 0 && (
                <span className="text-[7px] px-[3px] py-[1px] rounded-[1px] bg-black/65 text-[#ddd]">
                  +{extraCount}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
      {isTrackable && (
        <div className="absolute top-[4px] right-[4px]">
          <QuickAddButton
            tmdbId={item.id}
            mediaType={item.media_type as MediaType}
            title={title}
            posterPath={item.poster_path}
            releaseYear={year}
            providers={providers?.map(p => canonicalProviderId(p.provider_id))}
            genreIds={item.genre_ids}
          />
        </div>
      )}
      {isTrackable && showNotInterested && (
        <div className="absolute top-[4px] left-[4px]">
          <NotInterestedButton
            tmdbId={item.id}
            mediaType={item.media_type as MediaType}
            title={title}
            variant="icon"
          />
        </div>
      )}
      <Link href={href} className="no-underline text-text-primary">
        <div className="text-xs font-semibold overflow-hidden text-ellipsis whitespace-nowrap">
          {title}
        </div>
        <div className="text-xxs text-text-muted">
          {year ?? '—'} · {item.vote_average.toFixed(1)}
        </div>
      </Link>
    </div>
  );
}
