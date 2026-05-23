'use client';

import { useState, useEffect, useMemo } from 'react';
import { useDiscoverMovies, useDiscoverTV } from '@/hooks/useTMDB';
import { getProvider, SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';
import TitleGrid from '@/components/title/TitleGrid';
import type { TMDBSearchResult } from '@/types';

type Tab = 'new' | 'movies' | 'tv';

export default function ProviderPageClient({ id }: { id: string }) {
  const providerId = parseInt(id, 10);
  const provider = getProvider(providerId);
  const [tab, setTab] = useState<Tab>('new');
  const [page, setPage] = useState(1);
  const [allResults, setAllResults] = useState<TMDBSearchResult[]>([]);

  const oneMonthAgo = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  }, []);

  const movieParams = useMemo(() => {
    const base: Record<string, string> = { with_watch_providers: String(providerId) };
    if (tab === 'new') {
      base.sort_by = 'primary_release_date.desc';
      base['primary_release_date.gte'] = oneMonthAgo;
      base['vote_count.gte'] = '5';
    } else {
      base.sort_by = 'popularity.desc';
    }
    base.page = String(tab === 'new' ? 1 : page);
    return base;
  }, [providerId, tab, page, oneMonthAgo]);

  const tvParams = useMemo(() => {
    const base: Record<string, string> = { with_watch_providers: String(providerId) };
    if (tab === 'new') {
      base.sort_by = 'first_air_date.desc';
      base['first_air_date.gte'] = oneMonthAgo;
      base['vote_count.gte'] = '5';
    } else {
      base.sort_by = 'popularity.desc';
    }
    base.page = String(tab === 'new' ? 1 : page);
    return base;
  }, [providerId, tab, page, oneMonthAgo]);

  const { data: movies, isLoading: moviesLoading } = useDiscoverMovies(tab !== 'tv' ? movieParams : null);
  const { data: tv, isLoading: tvLoading } = useDiscoverTV(tab !== 'movies' ? tvParams : null);

  useEffect(() => { setPage(1); setAllResults([]); }, [tab, providerId]);

  useEffect(() => {
    if (tab === 'new') {
      const combined = [
        ...(movies?.results ?? []).map(r => ({ ...r, media_type: 'movie' as const })),
        ...(tv?.results ?? []).map(r => ({ ...r, media_type: 'tv' as const })),
      ].sort((a, b) => {
        const dateA = a.release_date || a.first_air_date || '';
        const dateB = b.release_date || b.first_air_date || '';
        return dateB.localeCompare(dateA);
      });
      setAllResults(combined);
    } else {
      const source = tab === 'movies' ? movies : tv;
      if (!source?.results) return;
      const typed = source.results.map(r => ({ ...r, media_type: (tab === 'movies' ? 'movie' : 'tv') as 'movie' | 'tv' }));
      if (page === 1) setAllResults(typed);
      else setAllResults(prev => [...prev, ...typed]);
    }
  }, [movies, tv, tab, page]);

  const isLoading = moviesLoading || tvLoading;
  const hasMore = tab !== 'new' && page < 5 && ((tab === 'movies' ? movies : tv)?.total_pages ?? 0) > page;
  const providerName = provider?.name ?? SWEDISH_PROVIDERS.find(p => p.id === providerId)?.name ?? 'Okänd tjänst';

  useEffect(() => {
    document.title = `${providerName} — Binge.nu`;
    return () => { document.title = 'Binge.nu — Håll koll på vad du tittar på'; };
  }, [providerName]);

  return (
    <div>
      <h1 className="text-[18px] font-bold text-text-primary mb-1">{providerName}</h1>
      <div className="flex items-center gap-2 mb-3">
        <div className="flex gap-[1px]">
          {([['new', 'Nytt'], ['movies', 'Filmer'], ['tv', 'Serier']] as const).map(([key, label]) => (
            <span
              key={key}
              onClick={() => setTab(key)}
              className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
                tab === key ? 'bg-accent text-white' : 'text-text-muted'
              }`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="bg-surface border border-border-main rounded-sm">
        <TitleGrid items={allResults} loading={isLoading && allResults.length === 0} />
      </div>

      {hasMore && (
        <button
          onClick={() => setPage(p => p + 1)}
          disabled={isLoading}
          className="mt-3 px-4 py-[5px] bg-surface border border-border-main rounded-sm text-xs font-[inherit] cursor-pointer text-text-secondary hover:bg-surface-hover disabled:opacity-50"
        >
          {isLoading ? 'Laddar…' : 'Visa fler'}
        </button>
      )}
    </div>
  );
}
