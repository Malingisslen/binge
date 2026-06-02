'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useMemo } from 'react';
import { useSearch } from '@/hooks/useTMDB';
import { useSearchProviders } from '@/hooks/useSearchProviders';
import { useAuth } from '@/hooks/useAuth';
import TitleGrid from '@/components/title/TitleGrid';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import { canonicalProviderId } from '@/lib/tmdb/providers';
import { isAddableMediaType } from '@/lib/tmdb/client';
import type { TMDBProvider } from '@/types';

type MediaFilter = 'all' | 'movie' | 'tv';

function SearchResults() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const { data, isLoading } = useSearch(query);
  const { user } = useAuth();
  const myProviders = useMemo(() => user?.myProviders ?? [], [user?.myProviders]);

  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [onlyMyServices, setOnlyMyServices] = useState(false);

  const allResults = useMemo(() =>
    (data?.results ?? []).filter(isAddableMediaType),
    [data]
  );

  const filteredByType = useMemo(() =>
    mediaFilter === 'all' ? allResults : allResults.filter(r => r.media_type === mediaFilter),
    [allResults, mediaFilter]
  );

  const rawProviderMap = useSearchProviders(filteredByType);

  const results = useMemo(() => {
    if (!onlyMyServices || myProviders.length === 0) return filteredByType;
    return filteredByType.filter(r => {
      const providers = rawProviderMap[`${r.media_type}-${r.id}`];
      if (!providers) return false;
      const flatrate = providers.flatrate ?? [];
      return flatrate.some(p => myProviders.includes(canonicalProviderId(p.provider_id)));
    });
  }, [filteredByType, onlyMyServices, myProviders, rawProviderMap]);

  const providerMap = useMemo(() => {
    const map: Record<string, TMDBProvider[]> = {};
    for (const [key, data] of Object.entries(rawProviderMap)) {
      if (data.flatrate) map[key] = data.flatrate;
    }
    return map;
  }, [rawProviderMap]);

  return (
    <>
      <header>
        <div className="crumb">Sök · {results.length} resultat</div>
        <h1 className="page-h1">Sökresultat för &ldquo;{query}&rdquo;</h1>
        <p className="stand">
          {results.length === 0
            ? 'Inga träffar. Försök med ett annat namn eller stavning.'
            : `${results.length} ${results.length === 1 ? 'titel matchar' : 'titlar matchar'} din sökning.`}
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 22, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'tv', 'movie'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setMediaFilter(f)}
              className={`chip${mediaFilter === f ? ' is-on' : ''}`}
            >
              {f === 'all' ? 'Alla' : f === 'tv' ? 'Serier' : 'Film'}
            </button>
          ))}
        </div>
        {myProviders.length > 0 && (
          <button
            type="button"
            onClick={() => setOnlyMyServices(prev => !prev)}
            className={`chip${onlyMyServices ? ' is-on' : ''}`}
          >
            Mina tjänster
          </button>
        )}
      </div>

      {isLoading ? (
        <LoadingView label="Söker…" />
      ) : results.length === 0 ? (
        <EmptyState title="Inga träffar" body="Prova ett annat sökord." />
      ) : (
        <div className="bg-surface border border-border-main rounded-sm">
          <TitleGrid items={results} providerMap={providerMap} />
          <div className="px-3 py-[6px] border-t border-border-light">
            <JustWatchCredit />
          </div>
        </div>
      )}
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="text-sm text-text-muted py-4">Laddar…</div>}>
      <SearchResults />
    </Suspense>
  );
}
