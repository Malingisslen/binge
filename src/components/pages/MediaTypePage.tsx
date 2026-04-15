'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { posterUrl } from '@/lib/tmdb/client';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { usePopularTV, usePopularMovies } from '@/hooks/useTMDB';
import { hasNonLatinTitle, isFromHiddenCountry } from '@/lib/utils/titleFilter';
import TitleGrid from '@/components/title/TitleGrid';
import type { MediaType, TMDBSearchResult } from '@/types';

const CONFIG = {
  tv: { title: 'Serier', popularLabel: 'Populära serier', emptyText: 'Du tittar inte på några serier ännu. Lägg till nedan!', hrefPrefix: '/tv/' },
  movie: { title: 'Filmer', popularLabel: 'Populära filmer', emptyText: 'Du tittar inte på några filmer ännu. Lägg till nedan!', hrefPrefix: '/movie/' },
} as const;

export default function MediaTypePage({ mediaType }: { mediaType: MediaType }) {
  const { getByStatus } = useWatchlist();
  const { user } = useAuth();
  const hideNonLatin = user?.hideNonLatinTitles ?? false;
  const hiddenCountries = user?.hiddenCountries ?? [];
  const following = getByStatus('följer', mediaType);
  const [page, setPage] = useState(1);
  const [allResults, setAllResults] = useState<TMDBSearchResult[]>([]);

  const { data: popularTV, isLoading: tvLoading } = usePopularTV(mediaType === 'tv' ? page : 1);
  const { data: popularMovies, isLoading: movieLoading } = usePopularMovies(mediaType === 'movie' ? page : 1);
  const popular = mediaType === 'tv' ? popularTV : popularMovies;
  const isLoading = mediaType === 'tv' ? tvLoading : movieLoading;

  useEffect(() => {
    if (!popular?.results) return;
    const typed = popular.results.map(r => ({ ...r, media_type: mediaType }));
    if (page === 1) {
      setAllResults(typed);
    } else {
      setAllResults(prev => [...prev, ...typed]);
    }
  }, [popular, page, mediaType]);

  const hasMore = popular && page < popular.total_pages && page < 5;
  const cfg = CONFIG[mediaType];

  return (
    <div>
      <h1 className="text-[18px] font-bold text-text-primary mb-3">{cfg.title}</h1>

      {following.length > 0 ? (
        <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
          <div className="flex items-center justify-between px-3 py-[6px] border-b border-border-light">
            <span className="text-sm font-bold text-text-secondary">Följer</span>
            <Link href="/my/following/" className="text-xs text-accent no-underline">
              Alla {following.length} →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-[10px] md:gap-[7px] px-3 py-2">
            {following.slice(0, 10).map(item => {
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
        <TitleGrid
          items={allResults.filter(r =>
            (!hideNonLatin || !hasNonLatinTitle(r.title ?? r.name, r.original_title ?? r.original_name)) &&
            !isFromHiddenCountry(r.origin_country, hiddenCountries))}
          loading={isLoading && allResults.length === 0}
        />
      </div>

      {hasMore && (
        <button
          onClick={() => setPage(p => p + 1)}
          disabled={isLoading}
          className="mt-3 px-4 py-[5px] bg-surface border border-border-main rounded-sm text-xs font-[inherit] cursor-pointer text-text-secondary hover:bg-surface-hover disabled:opacity-50"
        >
          {isLoading ? 'Laddar...' : 'Visa fler'}
        </button>
      )}
    </div>
  );
}
