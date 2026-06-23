'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTrending } from '@/hooks/useTMDB';
import { discoverMovies, discoverTV, getMovieGenres, getTVGenres, isAddableMediaType } from '@/lib/tmdb/client';
import { useAuth } from '@/hooks/useAuth';
import TitleGrid from '@/components/title/TitleGrid';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import type { TMDBSearchResult } from '@/types';
import { hasNonLatinTitle, isFromHiddenCountry } from '@/lib/utils/titleFilter';
import { JsonLd, breadcrumbSchema, collectionPageSchema } from '@/components/title/JsonLd';
import { nordicLanguageParam } from '@/lib/discover/nordic';

const DISCOVER_DESCRIPTION = 'Trendande, populära och nya filmer och serier på Netflix, Viaplay, HBO Max, Disney+, SVT Play och fler svenska streamingtjänster.';

type Tab = 'trending' | 'movies' | 'tv';
type SortOption = 'popularity.desc' | 'vote_average.desc' | 'primary_release_date.desc';

const SORT_LABELS: Record<SortOption, string> = {
  'popularity.desc': 'Popularitet',
  'vote_average.desc': 'Betyg',
  'primary_release_date.desc': 'Nyast',
};

export default function DiscoverPage() {
  const [tab, setTab] = useState<Tab>('trending');
  const [genre, setGenre] = useState<string>('');
  const [sort, setSort] = useState<SortOption>('popularity.desc');
  const [myServices, setMyServices] = useState(false);
  const [nordic, setNordic] = useState(false);
  const [page, setPage] = useState(1);
  const [allResults, setAllResults] = useState<TMDBSearchResult[]>([]);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    setPage(1);
    setAllResults([]);
  }, [tab, genre, sort, myServices, nordic]);

  const { data: movieGenres } = useQuery({
    queryKey: ['genres-movie'],
    queryFn: getMovieGenres,
    staleTime: 60 * 60 * 1000,
  });
  const { data: tvGenres } = useQuery({
    queryKey: ['genres-tv'],
    queryFn: getTVGenres,
    staleTime: 60 * 60 * 1000,
  });

  // Merge both genre lists for trending (which has both movies and TV)
  const genres = tab === 'movies'
    ? movieGenres?.genres
    : tab === 'tv'
    ? tvGenres?.genres
    : (() => {
        const all = [...(movieGenres?.genres ?? []), ...(tvGenres?.genres ?? [])];
        const seen = new Set<number>();
        return all.filter(g => { if (seen.has(g.id)) return false; seen.add(g.id); return true; }).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
      })();

  const { data: trending, isLoading: trendingLoading } = useTrending('all', 'week');

  const hiddenCountries = user?.hiddenCountries ?? [];

  const discoverParams: Record<string, string> = {
    sort_by: sort,
    page: String(page),
    ...(genre ? { with_genres: genre } : {}),
    ...(myServices && user?.myProviders.length
      ? { with_watch_providers: user.myProviders.join('|') }
      : {}),
    ...(nordic ? { with_original_language: nordicLanguageParam() } : {}),
    ...(hiddenCountries.length
      ? { without_origin_country: hiddenCountries.join(',') }
      : {}),
  };

  // Prefetcha nästa sida på hover av "Visa fler" — samma queryKey som listan
  // använder (['discover', tab, params]) fast med page+1, så klicket växer
  // listan direkt. Bara för riktiga discover-tabbar (trending paginerar inte).
  const prefetchNextPage = () => {
    if (tab === 'trending') return;
    const nextParams = { ...discoverParams, page: String(page + 1) };
    void queryClient.prefetchQuery({
      queryKey: ['discover', tab, nextParams],
      queryFn: () => (tab === 'movies' ? discoverMovies(nextParams) : discoverTV(nextParams)),
      staleTime: 5 * 60 * 1000,
    });
  };

  const { data: discoverData, isLoading: discoverLoading } = useQuery({
    queryKey: ['discover', tab, discoverParams],
    queryFn: () => tab === 'movies' ? discoverMovies(discoverParams) : discoverTV(discoverParams),
    enabled: tab !== 'trending',
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!discoverData?.results) return;
    const mediaType = tab === 'movies' ? 'movie' : 'tv';
    const typed = discoverData.results.map(r => ({ ...r, media_type: mediaType as 'movie' | 'tv' }));
    if (page === 1) {
      setAllResults(typed);
    } else {
      setAllResults(prev => [...prev, ...typed]);
    }
  }, [discoverData, page, tab]);

  const isLoading = tab === 'trending' ? trendingLoading : discoverLoading;
  const hideNonLatin = user?.hideNonLatinTitles ?? false;
  const genreId = genre ? parseInt(genre, 10) : null;
  const items = tab === 'trending'
    ? (trending?.results ?? []).filter(r =>
        isAddableMediaType(r) &&
        (!hideNonLatin || !hasNonLatinTitle(r.title ?? r.name, r.original_title ?? r.original_name)) &&
        !isFromHiddenCountry(r.origin_country, hiddenCountries) &&
        (!genreId || r.genre_ids?.includes(genreId)))
    : (hideNonLatin ? allResults.filter(r => !hasNonLatinTitle(r.title ?? r.name, r.original_title ?? r.original_name)) : allResults);
  const hasMore = tab !== 'trending' && discoverData && page < discoverData.total_pages;

  return (
    <>
      <JsonLd data={breadcrumbSchema([
        { name: 'Binge.nu', url: 'https://binge.nu/' },
        { name: 'Utforska', url: 'https://binge.nu/discover/' },
      ])} />
      <JsonLd data={collectionPageSchema({
        name: 'Utforska film och serier i Sverige',
        description: DISCOVER_DESCRIPTION,
        url: 'https://binge.nu/discover/',
      })} />

      <header>
        <div className="crumb">Utforska</div>
        <h1 className="page-h1">Utforska</h1>
        <p className="stand">
          Trendande just nu, populära filmer och serier, eller filtrera per genre.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 6, marginTop: 22, flexWrap: 'wrap' }}>
        {([
          ['trending', 'Trendande'],
          ['movies', 'Filmer'],
          ['tv', 'Serier'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={`chip ${tab === key ? 'is-on' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
          {tab === 'trending' && <span className="text-xs text-text-muted">Filtrera:</span>}
          {/* Genre filter */}
          <select
            value={genre}
            onChange={e => setGenre(e.target.value)}
            className="select"
          >
            <option value="">Alla genrer</option>
            {(genres ?? []).map(g => (
              <option key={g.id} value={String(g.id)}>{g.name}</option>
            ))}
          </select>

          {/* Sort — only for discover tabs */}
          {tab !== 'trending' && (
            <select
              value={sort}
              onChange={e => setSort(e.target.value as SortOption)}
              className="select"
            >
              {Object.entries(SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          )}

          {/* My services toggle */}
          {tab !== 'trending' && user && user.myProviders.length > 0 && (
            <label className="flex items-center gap-1 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={myServices}
                onChange={e => setMyServices(e.target.checked)}
                className="accent-accent w-[13px] h-[13px]"
              />
              Mina tjänster
            </label>
          )}

          {/* Svenskt & nordiskt lens (BIN-192) — filtrerar till nordiska originalspråk */}
          {tab !== 'trending' && (
            <label className="flex items-center gap-1 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={nordic}
                onChange={e => setNordic(e.target.checked)}
                className="accent-accent w-[13px] h-[13px]"
              />
              Svenskt &amp; nordiskt
            </label>
          )}
        </div>

      <div className="bg-surface border border-border-main rounded-sm">
        <TitleGrid items={items} loading={isLoading && items.length === 0} />
        <div className="px-3 py-[6px] border-t border-border-light">
          <JustWatchCredit />
        </div>
      </div>

      {hasMore && (
        <button
          onClick={() => setPage(p => p + 1)}
          onMouseEnter={prefetchNextPage}
          onFocus={prefetchNextPage}
          disabled={discoverLoading}
          className="btn btn-ghost btn-sm disabled:opacity-50"
        >
          {discoverLoading ? 'Laddar…' : 'Visa fler'}
        </button>
      )}
    </>
  );
}
