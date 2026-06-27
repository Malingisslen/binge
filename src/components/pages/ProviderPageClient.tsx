'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useDiscoverMovies, useDiscoverTV } from '@/hooks/useTMDB';
import { getProvider, canonicalProviderId, SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';
import { SEO_PROVIDER_IDS } from '@/lib/tmdb/seoCoverage';
import { usePageMeta } from '@/hooks/usePageMeta';
import ProviderDot from '@/components/ui/ProviderDot';
import TitleGrid from '@/components/title/TitleGrid';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/PageHeader';
import { localIsoDate } from '@/lib/utils';
import type { TMDBSearchResult } from '@/types';

type Tab = 'new' | 'movies' | 'tv';

export default function ProviderPageClient({
  id,
  initialTab = 'new',
  initialItems,
}: {
  id: string;
  // SEO-routen (src/app/provider/[id]/page.tsx) seedar populära titlar +
  // 'movies'-fliken så den pre-renderade HTML:en har riktigt innehåll för
  // Googlebot; nav-nådda sidor använder defaulten ('new', tom).
  initialTab?: Tab;
  initialItems?: TMDBSearchResult[];
}) {
  const providerId = parseInt(id, 10);
  const provider = getProvider(providerId);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [page, setPage] = useState(1);
  const [allResults, setAllResults] = useState<TMDBSearchResult[]>(initialItems ?? []);
  // Reset-effekten nedan kör på mount också; skippa första varvet så seedade
  // initialItems inte wipas direkt vid hydrering.
  const firstReset = useRef(true);

  const oneMonthAgo = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return localIsoDate(d);
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

  useEffect(() => {
    if (firstReset.current) { firstReset.current = false; return; }
    setPage(1); setAllResults([]);
  }, [tab, providerId]);

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

  // Bara den kurerade SEO-uppsättningen indexeras; long-tail-providers (nådda
  // via catch-all) förblir noindex. Måste matcha generateStaticParams-mängden i
  // src/app/provider/[id]/page.tsx, annars sätter klient-hydreringen noindex på
  // en sida vars statiska HTML säger index (eller tvärtom).
  const indexable = SEO_PROVIDER_IDS.includes(canonicalProviderId(providerId));
  usePageMeta({
    title: `${providerName} — streama filmer och serier i Sverige`,
    description: `Vad streamar på ${providerName} i Sverige just nu? Populära filmer och serier, nyheter och var du ser dem — spåra allt med Binge.`,
    indexable,
  });

  return (
    <div>
      <PageHeader
        crumb="Streamingtjänst"
        title={providerName}
        icon={provider?.color ? <ProviderDot color={provider.color} size={10} /> : undefined}
      />
      <div className="flex items-center gap-2 mt-3 mb-3">
        <div className="flex gap-[6px]">
          {([['new', 'Nytt'], ['movies', 'Filmer'], ['tv', 'Serier']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`chip ${tab === key ? 'is-on' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {indexable && (
        <div className="mb-3">
          <Link href={`/forsvinner/${canonicalProviderId(providerId)}/`} className="text-sm text-acc-deep hover:underline">
            Vad försvinner från {providerName} snart? →
          </Link>
        </div>
      )}

      <div className="bg-surface border border-rule rounded-sm">
        <TitleGrid items={allResults} loading={isLoading && allResults.length === 0} />
        <div className="px-3 py-[6px] border-t border-rule">
          <JustWatchCredit />
        </div>
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
