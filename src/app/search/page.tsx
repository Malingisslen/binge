'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useMemo } from 'react';
import { useSearch } from '@/hooks/useTMDB';
import { useSearchProviders } from '@/hooks/useSearchProviders';
import { useAuth } from '@/hooks/useAuth';
import TitleGrid from '@/components/title/TitleGrid';
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
      <div className="mb-3">
        <h1 className="text-[18px] font-bold text-text-primary">
          Sökresultat för &quot;{query}&quot;
        </h1>
        {data && (
          <span className="text-xs text-text-muted">{results.length} resultat</span>
        )}
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex gap-[1px]">
          {(['all', 'tv', 'movie'] as const).map(f => (
            <span
              key={f}
              onClick={() => setMediaFilter(f)}
              className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
                mediaFilter === f ? 'bg-accent text-white' : 'text-text-muted'
              }`}
            >
              {f === 'all' ? 'Alla' : f === 'tv' ? 'Serier' : 'Film'}
            </span>
          ))}
        </div>
        {myProviders.length > 0 && (
          <span
            onClick={() => setOnlyMyServices(prev => !prev)}
            className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
              onlyMyServices ? 'bg-accent text-white' : 'text-text-muted'
            }`}
          >
            Mina tjänster
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-text-muted py-4">Söker...</div>
      ) : results.length === 0 ? (
        <div className="text-sm text-text-muted py-4">Inga resultat hittades.</div>
      ) : (
        <div className="bg-surface border border-border-main rounded-sm">
          <TitleGrid items={results} providerMap={providerMap} />
        </div>
      )}
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="text-sm text-text-muted py-4">Laddar...</div>}>
      <SearchResults />
    </Suspense>
  );
}
