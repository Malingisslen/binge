'use client';

import { useRouter } from 'next/navigation';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useRecommendationsCascade } from '@/hooks/useRecommendationsCascade';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useNotInterested } from '@/hooks/useNotInterested';
import { useAuth } from '@/hooks/useAuth';
import { parseRowKey, DEFAULT_FILTERS } from '@/types';
import type { FilterState, RowSpec, RowResult, RowTitle, MediaTypeFilter } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';

const MEDIA_TABS: ReadonlyArray<{ value: MediaTypeFilter; label: string }> = [
  { value: 'all', label: 'Alla' },
  { value: 'movie', label: 'Filmer' },
  { value: 'tv', label: 'Serier' },
];
import RecommendationsFilters from './RecommendationsFilters';
import TitleGrid from '@/components/title/TitleGrid';
import { useRowTrending } from '@/hooks/rows/useRowTrending';
import { useRowLatestFav } from '@/hooks/rows/useRowLatestFav';
import { useRowSimilar } from '@/hooks/rows/useRowSimilar';
import { useRowPerson } from '@/hooks/rows/useRowPerson';
import { useRowGenreCanon } from '@/hooks/rows/useRowGenreCanon';
import { useRowThematic } from '@/hooks/rows/useRowThematic';
import { useRowUpcoming } from '@/hooks/rows/useRowUpcoming';

interface Props {
  rowKeyParam: string;
}

type SortKey = 'relevance' | 'rating' | 'release';

function applySort(items: RowTitle[], sort: SortKey): RowTitle[] {
  if (sort === 'rating')   return [...items].sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
  if (sort === 'release')  {
    const d = (x: RowTitle) => x.release_date ?? x.first_air_date ?? '';
    return [...items].sort((a, b) => d(b).localeCompare(d(a)));
  }
  return items;
}

function gridFromResult(result: RowResult, sort: SortKey) {
  const all = [...result.visible, ...result.backingPool];
  return <TitleGrid items={applySort(all, sort)} loading={result.isLoading && all.length === 0} showNotInterested />;
}

export default function RecommendationsExpanded({ rowKeyParam }: Props) {
  const id = parseRowKey(rowKeyParam);
  const cascade = useRecommendationsCascade();
  const spec = cascade.rows.find(r => r.rowKey === rowKeyParam);
  const { items } = useWatchlist();
  const { items: ni, loading: niLoading } = useNotInterested();
  const { user } = useAuth();
  const router = useRouter();
  const goBack = useCallback(() => router.push('/recommendations'), [router]);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortKey>('relevance');

  const userHideNonLatin = user?.hideNonLatinTitles ?? false;
  const userHiddenCountries = user?.hiddenCountries ?? [];
  useEffect(() => {
    setFilters(f => (
      f.hideNonLatinTitles === userHideNonLatin && f.hiddenCountries === userHiddenCountries
        ? f
        : { ...f, hideNonLatinTitles: userHideNonLatin, hiddenCountries: userHiddenCountries }
    ));
  }, [userHideNonLatin, userHiddenCountries]);

  const excludedIds = useMemo(() => {
    const s = new Set<number>();
    for (const i of items) s.add(i.tmdbId);
    for (const n of ni) s.add(n.tmdbId);
    return s;
  }, [items, ni]);

  if (!id || !spec) {
    return (
      <div>
        <button
          onClick={goBack}
          className="inline-flex items-center gap-1 text-xs px-3 py-[6px] mb-3 border border-border-main rounded-sm bg-surface text-text-secondary hover:bg-surface-hover cursor-pointer"
        >
          <ChevronLeft size={14} /> Tillbaka till rekommendationer
        </button>
        <p className="text-sm text-text-muted">Raden hittades inte. Den kan ha försvunnit när dina betyg ändrades.</p>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={goBack}
        className="inline-flex items-center gap-1 text-xs px-3 py-[6px] mb-3 border border-border-main rounded-sm bg-surface text-text-secondary hover:bg-surface-hover cursor-pointer"
      >
        <ChevronLeft size={14} /> Tillbaka till rekommendationer
      </button>
      <PageHeader
        crumb="Rekommendationer"
        title={spec.label}
        standfirst={spec.description ?? undefined}
      />

      <div className="flex gap-[1px] mb-3">
        {MEDIA_TABS.map(t => (
          <span
            key={t.value}
            onClick={() => setFilters(f => ({ ...f, mediaType: t.value }))}
            className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
              filters.mediaType === t.value ? 'bg-accent text-white' : 'text-text-muted'
            }`}
          >
            {t.label}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <RecommendationsFilters filters={filters} onChange={setFilters} hasMyProviders={cascade.hasMyProviders} />
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="text-xs border border-border-main rounded-sm px-2 py-[2px] bg-surface text-text-secondary">
          <option value="relevance">Relevans</option>
          <option value="rating">Betyg</option>
          <option value="release">Premiärdatum</option>
        </select>
      </div>

      {niLoading ? (
        // Vänta på "inte intresserad"-listan innan gridden renderas — annars
        // blinkar avfärdade titlar in tills snapshotten landat (BIN-37).
        <LoadingView variant="grid" label="Laddar rekommendationer…" />
      ) : (
        <ExpandedDispatch
          spec={spec}
          excludedIds={excludedIds}
          filters={filters}
          sort={sort}
          myProviders={user?.myProviders ?? []}
          topGenreIds={cascade.topGenreIds}
          hiddenCountries={user?.hiddenCountries ?? []}
          latestFiveStar={cascade.latestFiveStar}
        />
      )}
    </>
  );
}

interface DispatchProps {
  spec: RowSpec;
  excludedIds: ReadonlySet<number>;
  filters: FilterState;
  sort: SortKey;
  myProviders: number[];
  topGenreIds: number[];
  hiddenCountries: string[];
  latestFiveStar: { tmdbId: number; mediaType: 'movie' | 'tv'; daysSince: number } | null;
}

function ExpandedDispatch(props: DispatchProps) {
  switch (props.spec.id.kind) {
    case 'trending':    return <TrendingExpanded {...props} />;
    case 'latest-fav':  return <LatestFavExpanded {...props} />;
    case 'similar':     return <SimilarExpanded {...props} />;
    case 'person':      return <PersonExpanded {...props} />;
    case 'genre-canon': return <GenreExpanded {...props} />;
    case 'thematic':    return <ThematicExpanded {...props} />;
    case 'upcoming':    return <UpcomingExpanded {...props} />;
  }
}

function TrendingExpanded({ spec, excludedIds, filters, sort }: DispatchProps) {
  const r = useRowTrending(spec, excludedIds, filters);
  return gridFromResult(r, sort);
}

function LatestFavExpanded({ spec, excludedIds, filters, sort, latestFiveStar }: DispatchProps) {
  const seed = latestFiveStar ? { tmdbId: latestFiveStar.tmdbId, mediaType: latestFiveStar.mediaType } : null;
  const r = useRowLatestFav(spec, seed, excludedIds, filters);
  return gridFromResult(r, sort);
}

function SimilarExpanded({ spec, excludedIds, filters, sort }: DispatchProps) {
  const r = useRowSimilar(spec, excludedIds, filters);
  return gridFromResult(r, sort);
}

function PersonExpanded({ spec, excludedIds, filters, sort }: DispatchProps) {
  const r = useRowPerson(spec, excludedIds, filters);
  return gridFromResult(r, sort);
}

function GenreExpanded({ spec, excludedIds, filters, sort }: DispatchProps) {
  const r = useRowGenreCanon(spec, excludedIds, filters);
  return gridFromResult(r, sort);
}

function ThematicExpanded({ spec, excludedIds, filters, sort }: DispatchProps) {
  const r = useRowThematic(spec, excludedIds, filters);
  return gridFromResult(r, sort);
}

function UpcomingExpanded({ spec, excludedIds, filters, sort, myProviders, topGenreIds }: DispatchProps) {
  const r = useRowUpcoming(spec, myProviders, topGenreIds, excludedIds, filters);
  return gridFromResult(r, sort);
}
