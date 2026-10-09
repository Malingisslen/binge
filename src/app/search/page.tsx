'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useSearch } from '@/hooks/useTMDB';
import { useSearchProviders } from '@/hooks/useSearchProviders';
import { useAuth } from '@/hooks/useAuth';
import TitleGrid from '@/components/title/TitleGrid';
import TitleRow from '@/components/title/TitleRow';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import { canonicalProviderId, dedupeProvidersByCanonicalId } from '@/lib/tmdb/providers';
import { isAddableMediaType } from '@/lib/tmdb/client';
import { trackEvent } from '@/lib/analytics';
import { departmentLabel, rankPeople } from '@/lib/searchPeople';
import type { TMDBProvider } from '@/types';
import { cardClass } from '@/components/ui/Card';

type MediaFilter = 'all' | 'movie' | 'tv';

function SearchResults() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const { data, isLoading } = useSearch(query);
  const { user } = useAuth();
  const myProviders = useMemo(() => user?.myProviders ?? [], [user?.myProviders]);

  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [onlyMyServices, setOnlyMyServices] = useState(false);

  // Sökfältet lovar "titel, person" — personträffar visas som länkar ovanför
  // titlarna i stället för att filtreras bort.
  // TMDB har ofta flera personer med samma namn. De mest kända först, och bara
  // några, så att sex likadana "Tom Holland" inte fyller raden.
  const people = useMemo(() => rankPeople(data?.results ?? []), [data]);

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

  useEffect(() => {
    if (!query.trim() || isLoading) return;
    trackEvent('search_submitted', { resultCount: results.length, mediaFilter });
    // Avsiktligt utelämnad: results.length. Vi vill fyra eventet en gång per
    // distinkt sökning (query + media-flik), inte vid varje provider-filter-
    // omräkning. results är en synkron useMemo så resultCount är aktuell här.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mediaFilter, isLoading]);

  const providerMap = useMemo(() => {
    const map: Record<string, TMDBProvider[]> = {};
    for (const [key, data] of Object.entries(rawProviderMap)) {
      // Dedup på kanoniskt id så sökkorten inte visar t.ex. "HBO" +
      // "HBO Max Amazon Channel" som två chips för samma tjänst (SÖ2).
      if (data.flatrate) map[key] = dedupeProvidersByCanonicalId(data.flatrate);
    }
    return map;
  }, [rawProviderMap]);

  return (
    <>
      <header>
        <div className="crumb">Sök · {results.length} resultat</div>
        <h1 className="page-h1">Sökresultat för &ldquo;{query}&rdquo;</h1>
        {results.length > 0 && (
          <p className="stand">
            {`${results.length} ${results.length === 1 ? 'titel matchar' : 'titlar matchar'} din sökning.`}
          </p>
        )}
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
              {f === 'all' ? 'Alla' : f === 'tv' ? 'Serier' : 'Filmer'}
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

      {people.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <span className="text-sm text-ink-2">Personer:</span>
          {people.map(p => (
            <Link key={p.id} href={`/person/${p.id}/`} className="chip no-underline">
              {p.name}{p.known_for_department ? ` · ${departmentLabel(p.known_for_department)}` : ''}
            </Link>
          ))}
        </div>
      )}

      {isLoading ? (
        <LoadingView label="Söker…" />
      ) : results.length === 0 ? (
        <EmptyState title="Inga träffar" body="Försök med ett annat namn eller stavning." />
      ) : (
        <div className={cardClass()}>
          {/* Switched in CSS, not on window width, so server and client render the same. */}
          <div className="md:hidden px-3 divide-y divide-rule-2">
            {results.map(item => (
              <TitleRow
                key={`${item.media_type}-${item.id}`}
                item={item}
                providers={providerMap[`${item.media_type}-${item.id}`]}
              />
            ))}
          </div>
          <div className="hidden md:block">
            <TitleGrid items={results} providerMap={providerMap} />
          </div>
          <div className="px-3 py-1.5 border-t border-rule-2">
            <JustWatchCredit />
          </div>
        </div>
      )}
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<LoadingView label="Laddar sökningen…" />}>
      <SearchResults />
    </Suspense>
  );
}
