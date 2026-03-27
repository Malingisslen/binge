'use client';

import Link from 'next/link';
import { posterUrl } from '@/lib/tmdb/client';
import type { TMDBSearchResult } from '@/types';
import { getDisplayTitle, getReleaseYear } from '@/lib/tmdb/client';
import { useAuth } from '@/hooks/useAuth';
import { getProvider } from '@/lib/tmdb/providers';
import type { TMDBProvider, MediaType } from '@/types';
import QuickAddButton from './QuickAddButton';

interface TitleCardProps {
  item: TMDBSearchResult;
  providers?: TMDBProvider[];
}

export default function TitleCard({ item, providers }: TitleCardProps) {
  const { user } = useAuth();
  const href = item.media_type === 'movie' ? `/movie/${item.id}/` : `/tv/${item.id}/`;
  const title = getDisplayTitle(item);
  const year = getReleaseYear(item);
  const poster = posterUrl(item.poster_path, 'w342');
  const myProviders = user?.myProviders ?? [];
  const isTrackable = item.media_type === 'movie' || item.media_type === 'tv';

  return (
    <div className="group relative">
      <Link href={href} className="no-underline text-text-primary">
        <div className="aspect-[2/3] bg-[#ddd8d0] rounded-sm mb-[3px] relative overflow-hidden">
          {poster ? (
            <img src={poster} alt={title} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-2">
              <span className="text-[10px] text-text-muted text-center line-clamp-2">{title}</span>
            </div>
          )}
          {providers && providers.length > 0 && (
            <div className="absolute bottom-[2px] left-[2px] flex gap-[1px]">
              {providers.map(p => {
                const mapped = getProvider(p.provider_id);
                const isMine = myProviders.includes(p.provider_id);
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
