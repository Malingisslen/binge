'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { posterUrl } from '@/lib/tmdb/client';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { usePopularTV, usePopularMovies } from '@/hooks/useTMDB';
import { hasNonLatinTitle, isFromHiddenCountry } from '@/lib/utils/titleFilter';
import TitleGrid from '@/components/title/TitleGrid';
import { toneForId } from '@/lib/duotone';
import type { MediaType, TMDBSearchResult } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { JsonLd, breadcrumbSchema, collectionPageSchema } from '@/components/title/JsonLd';

const CONFIG = {
  tv: {
    title: 'Serier',
    standfirst: 'Alla TV-serier du följer — pågående, avslutade och kommande. Se var varje serie går att streama i Sverige.',
    popularLabel: 'Populära serier',
    emptyText: 'Du tittar inte på några serier ännu. Lägg till nedan!',
    hrefPrefix: '/tv/',
    path: '/series/',
  },
  movie: {
    title: 'Filmer',
    standfirst: 'Alla filmer du följer — sedda, sparade och kommande. Se var varje film går att streama i Sverige.',
    popularLabel: 'Populära filmer',
    emptyText: 'Du tittar inte på några filmer ännu. Lägg till nedan!',
    hrefPrefix: '/movie/',
    path: '/films/',
  },
} as const;

export default function MediaTypePage({
  mediaType,
  initialItems,
}: {
  mediaType: MediaType;
  // Build-time-seedade titlar från server-page.tsx (SEO internal linking).
  initialItems?: TMDBSearchResult[];
}) {
  const { getByStatus } = useWatchlist();
  const { user } = useAuth();
  const hideNonLatin = user?.hideNonLatinTitles ?? false;
  const hiddenCountries = user?.hiddenCountries ?? [];
  // För TV: items i 'mina'-samlingen. För film: vi tar 'sedd' (films har
  // inget aktivt-följer-tillstånd — sedd är terminal).
  const following = mediaType === 'tv'
    ? getByStatus('mina', 'tv')
    : getByStatus('sedd', 'movie');
  const [page, setPage] = useState(1);
  // Seedar med build-datat (server page.tsx) så exportens statiska HTML får
  // crawlbara titellänkar; live page-1-data ersätter seeden efter hydration.
  // OBS för framtida ändringar: effekten nedan är gated på popular?.results —
  // lägger du till en ovillkorlig reset-effekt behövs en firstReset-guard
  // (se ProviderPageClient), annars nollas seeden före hydration.
  const [allResults, setAllResults] = useState<TMDBSearchResult[]>(initialItems ?? []);

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
      <JsonLd data={breadcrumbSchema([
        { name: 'Binge.nu', url: 'https://binge.nu/' },
        { name: cfg.title, url: `https://binge.nu${cfg.path}` },
      ])} />
      <JsonLd data={collectionPageSchema({
        name: cfg.title,
        description: cfg.standfirst,
        url: `https://binge.nu${cfg.path}`,
      })} />

      <PageHeader crumb={cfg.title} title={cfg.title} standfirst={cfg.standfirst} />

      {following.length > 0 ? (
        <div className="bg-surface border border-rule rounded-sm mb-[14px]">
          <div className="flex items-center justify-between px-3 py-[6px] border-b border-rule-2">
            <h2 className="text-sm font-bold text-ink-2 m-0">Följer</h2>
            <Link href={mediaType === 'tv' ? '/my/series/' : '/my/films/'} className="text-xs text-acc-deep no-underline">
              Alla {following.length} →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-[10px] md:gap-[7px] px-3 py-2">
            {following.slice(0, 10).map(item => {
              const poster = posterUrl(item.posterPath, 'w342');
              return (
                <Link key={item.tmdbId} href={`${cfg.hrefPrefix}${item.tmdbId}/`} className="no-underline text-ink">
                  <div className={`poster duo-${toneForId(item.tmdbId)} mb-[3px]`}>
                    {poster && <img src={poster} alt={item.title} loading="lazy" decoding="async" width={342} height={513} />}
                  </div>
                  <div className="text-xs font-semibold overflow-hidden text-ellipsis whitespace-nowrap">{item.title}</div>
                </Link>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-surface border border-rule rounded-sm mb-[14px] px-3 py-4 text-center text-sm text-ink-3">
          {cfg.emptyText}
        </div>
      )}

      <div className="bg-surface border border-rule rounded-sm">
        <div className="px-3 py-[6px] border-b border-rule-2">
          <h2 className="text-sm font-bold text-ink-2 m-0">{cfg.popularLabel}</h2>
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
          className="btn btn-ghost btn-sm mt-3 disabled:opacity-50"
        >
          {isLoading ? 'Laddar…' : 'Visa fler'}
        </button>
      )}
    </div>
  );
}
