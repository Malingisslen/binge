'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useSearch } from '@/hooks/useTMDB';
import TitleGrid from '@/components/title/TitleGrid';

function SearchResults() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const { data, isLoading } = useSearch(query);

  const results = (data?.results ?? []).filter(
    r => r.media_type === 'movie' || r.media_type === 'tv'
  );

  return (
    <>
      <div className="mb-3">
        <h1 className="text-md font-bold text-text-primary">
          Sökresultat för &quot;{query}&quot;
        </h1>
        {data && (
          <span className="text-xs text-text-muted">{data.total_results} resultat</span>
        )}
      </div>
      {isLoading ? (
        <div className="text-sm text-text-muted py-4">Söker...</div>
      ) : results.length === 0 ? (
        <div className="text-sm text-text-muted py-4">Inga resultat hittades.</div>
      ) : (
        <div className="bg-surface border border-border-main rounded-sm">
          <TitleGrid items={results} />
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
