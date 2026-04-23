'use client';

import { useState, useMemo } from 'react';
import TitleGrid from './TitleGrid';
import { useSearchProviders } from '@/hooks/useSearchProviders';
import { useAuth } from '@/hooks/useAuth';
import { hasNonLatinTitle, isFromHiddenCountry } from '@/lib/utils/titleFilter';
import { canonicalProviderId } from '@/lib/tmdb/providers';
import type { TMDBSearchResult, TMDBProvider } from '@/types';

interface RecommendationsSectionProps {
  recommendations: (TMDBSearchResult & { media_type: 'movie' | 'tv' })[];
  myProviders: number[];
  label: string;
}

export default function RecommendationsSection({ recommendations, myProviders, label }: RecommendationsSectionProps) {
  const [onlyMyServices, setOnlyMyServices] = useState(false);
  const { user } = useAuth();
  const hideNonLatin = user?.hideNonLatinTitles ?? false;
  const hiddenCountries = user?.hiddenCountries ?? [];
  const visibleRecs = recommendations.filter(r =>
    (!hideNonLatin || !hasNonLatinTitle(r.title ?? r.name, r.original_title ?? r.original_name)) &&
    !isFromHiddenCountry(r.origin_country, hiddenCountries));
  const rawProviderMap = useSearchProviders(visibleRecs);

  const filtered = useMemo(() => {
    if (!onlyMyServices || myProviders.length === 0) return visibleRecs;
    return visibleRecs.filter(r => {
      const p = rawProviderMap[`${r.media_type}-${r.id}`];
      return p?.flatrate?.some(f => myProviders.includes(canonicalProviderId(f.provider_id)));
    });
  }, [visibleRecs, onlyMyServices, myProviders, rawProviderMap]);

  const providerMap = useMemo(() => {
    const map: Record<string, TMDBProvider[]> = {};
    for (const [key, data] of Object.entries(rawProviderMap)) {
      if (data.flatrate) map[key] = data.flatrate;
    }
    return map;
  }, [rawProviderMap]);

  if (visibleRecs.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-sm font-bold text-text-secondary">{label}</h2>
        {myProviders.length > 0 && (
          <span
            onClick={() => setOnlyMyServices(!onlyMyServices)}
            className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
              onlyMyServices ? 'bg-accent text-white' : 'text-text-muted'
            }`}
          >
            Mina tjänster
          </span>
        )}
      </div>
      <div className="bg-surface border border-border-main rounded-sm">
        <TitleGrid items={filtered} providerMap={providerMap} showNotInterested />
      </div>
    </div>
  );
}
