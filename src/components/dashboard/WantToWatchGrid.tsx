'use client';

import { useState } from 'react';
import Link from 'next/link';
import { posterUrl } from '@/lib/tmdb/client';
import { useAuth } from '@/hooks/useAuth';
import type { WatchlistItem } from '@/types';
type TabFilter = 'all' | 'mine';

interface WantToWatchGridProps {
  items: WatchlistItem[];
}

export default function WantToWatchGrid({ items }: WantToWatchGridProps) {
  const [filter, setFilter] = useState<TabFilter>('all');
  const { user } = useAuth();
  const myProviders = user?.myProviders ?? [];

  const filtered = filter === 'mine'
    ? items.filter(i => i.providers?.some(p => myProviders.includes(p)))
    : items;

  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
      <div className="flex items-center justify-between px-3 py-[6px] border-b border-border-light">
        <div className="flex items-center">
          <span className="text-sm font-bold text-text-secondary">Vill se</span>
          <div className="flex gap-[1px] ml-[10px]">
            <span
              onClick={() => setFilter('all')}
              className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
                filter === 'all' ? 'bg-accent text-white' : 'text-text-muted'
              }`}
            >
              Alla
            </span>
            <span
              onClick={() => setFilter('mine')}
              className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
                filter === 'mine' ? 'bg-accent text-white' : 'text-text-muted'
              }`}
            >
              Mina tjänster
            </span>
          </div>
        </div>
        <Link href="/my/want-to-watch" className="text-xs text-accent no-underline">
          {items.length} →
        </Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-[7px] px-3 py-2">
        {filtered.map(item => {
          const poster = posterUrl(item.posterPath, 'w342');
          const href = item.mediaType === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;

          return (
            <Link key={item.tmdbId} href={href} className="no-underline text-text-primary">
              <div className="aspect-[2/3] bg-[#ddd8d0] rounded-sm mb-[3px] relative overflow-hidden">
                {poster && (
                  <img src={poster} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                )}
              </div>
              <div className="text-xs font-semibold overflow-hidden text-ellipsis whitespace-nowrap">
                {item.title}
              </div>
              <div className="text-xxs text-text-muted">
                {item.releaseYear ?? '—'}
              </div>
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-4 text-sm text-text-muted">
            Inga titlar att visa
          </div>
        )}
      </div>
    </div>
  );
}
