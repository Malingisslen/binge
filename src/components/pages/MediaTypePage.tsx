'use client';

import Link from 'next/link';
import { posterUrl } from '@/lib/tmdb/client';
import { useWatchlist } from '@/hooks/useWatchlist';
import { usePopularTV, usePopularMovies } from '@/hooks/useTMDB';
import TitleGrid from '@/components/title/TitleGrid';
import type { MediaType } from '@/types';

const CONFIG = {
  tv: { title: 'Serier', popularLabel: 'Populära serier', emptyText: 'Du tittar inte på några serier ännu. Lägg till nedan!', hrefPrefix: '/tv/' },
  movie: { title: 'Filmer', popularLabel: 'Populära filmer', emptyText: 'Du tittar inte på några filmer ännu. Lägg till nedan!', hrefPrefix: '/movie/' },
} as const;

export default function MediaTypePage({ mediaType }: { mediaType: MediaType }) {
  const { getByStatus } = useWatchlist();
  const watching = getByStatus('watching', mediaType);
  const { data: popularTV } = usePopularTV();
  const { data: popularMovies } = usePopularMovies();
  const popular = mediaType === 'tv' ? popularTV : popularMovies;
  const popularResults = (popular?.results ?? []).map(r => ({ ...r, media_type: mediaType }));
  const cfg = CONFIG[mediaType];

  return (
    <div>
      <h1 className="text-md font-bold text-text-primary mb-3">{cfg.title}</h1>

      {watching.length > 0 ? (
        <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
          <div className="flex items-center justify-between px-3 py-[6px] border-b border-border-light">
            <span className="text-sm font-bold text-text-secondary">Tittar på</span>
            <Link href="/my/watching/" className="text-xs text-accent no-underline">
              Alla {watching.length} →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-[7px] px-3 py-2">
            {watching.slice(0, 10).map(item => {
              const poster = posterUrl(item.posterPath, 'w342');
              return (
                <Link key={item.tmdbId} href={`${cfg.hrefPrefix}${item.tmdbId}/`} className="no-underline text-text-primary">
                  <div className="aspect-[2/3] bg-[#ddd8d0] rounded-sm mb-[3px] overflow-hidden">
                    {poster && <img src={poster} alt={item.title} className="w-full h-full object-cover" loading="lazy" />}
                  </div>
                  <div className="text-xs font-semibold overflow-hidden text-ellipsis whitespace-nowrap">{item.title}</div>
                </Link>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-surface border border-border-main rounded-sm mb-[14px] px-3 py-4 text-center text-sm text-text-muted">
          {cfg.emptyText}
        </div>
      )}

      <div className="bg-surface border border-border-main rounded-sm">
        <div className="px-3 py-[6px] border-b border-border-light">
          <span className="text-sm font-bold text-text-secondary">{cfg.popularLabel}</span>
        </div>
        <TitleGrid items={popularResults} />
      </div>
    </div>
  );
}
