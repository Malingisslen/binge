'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useCallback, useContext, createContext } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useRecommendationsCascade } from '@/hooks/useRecommendationsCascade';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useNotInterested } from '@/hooks/useNotInterested';
import { useAuth } from '@/hooks/useAuth';
import { parseRowKey } from '@/types';
import type { FilterState, RowSpec, RowResult } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';

import RecommendationsFilters, { useRecommendationFilters, activeRecFilterCount } from './RecommendationsFilters';
import { FilteredEmptyState } from '@/components/filters/TitleFilters';
import { wantedProviderIds } from '@/lib/filters/titleFilters';
import type { RowRefinement } from '@/lib/recommendations/refineTitles';
import TitleGrid from '@/components/title/TitleGrid';
import { useRowTrending } from '@/hooks/rows/useRowTrending';
import { useRowLatestFav } from '@/hooks/rows/useRowLatestFav';
import { useRowSimilar } from '@/hooks/rows/useRowSimilar';
import { useRowPerson } from '@/hooks/rows/useRowPerson';
import { useRowGenreCanon } from '@/hooks/rows/useRowGenreCanon';
import { useRowThematic } from '@/hooks/rows/useRowThematic';
import { useRowUpcoming } from '@/hooks/rows/useRowUpcoming';
import { useRowFreePublic } from '@/hooks/rows/useRowFreePublic';
import { useRowCompanion } from '@/hooks/rows/useRowCompanion';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import { Button } from '@/components/ui/Button';
import { RowRefinementContext } from './rowRefinementContext';
import { useRefinedTitles } from '@/hooks/useRefinedTitles';

/** "Rensa alla" for the empty state, or null when no filter is on (then empty means empty). */
const ClearFiltersContext = createContext<(() => void) | null>(null);

interface Props {
  rowKeyParam: string;
}

function ResultGrid({ result }: { result: RowResult }) {
  const refinement = useContext(RowRefinementContext);
  const pool = useMemo(() => [...result.visible, ...result.backingPool], [result.visible, result.backingPool]);
  const { items, pending } = useRefinedTitles(pool, refinement);
  const loading = (result.isLoading || pending) && items.length === 0;
  const clearAll = useContext(ClearFiltersContext);
  if (!loading && items.length === 0 && clearAll) return <FilteredEmptyState noun="förslag" onClearAll={clearAll} />;
  return <TitleGrid items={items} loading={loading} showNotInterested />;
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
  const userHiddenCountries = useMemo(() => user?.hiddenCountries ?? [], [user?.hiddenCountries]);
  const myProviders = useMemo(() => user?.myProviders ?? [], [user?.myProviders]);
  const { filters, setFilters, clearAll } = useRecommendationFilters({
    hideNonLatinTitles: user?.hideNonLatinTitles ?? false,
    hiddenCountries: userHiddenCountries,
    myProviders,
  });
  const refinement = useMemo<RowRefinement>(() => ({
    providerIds: wantedProviderIds(filters, myProviders),
    runtimeMin: filters.runtimeMin,
    runtimeMax: filters.runtimeMax,
    sort: filters.sort,
  }), [filters, myProviders]);

  const excludedIds = useMemo(() => {
    // BIN-560 Phase 4: composite-keyed (mediaTypeDocId) so a tracked movie can't
    // exclude a same-numbered TV recommendation (or vice versa).
    const s = new Set<string>();
    for (const i of items) s.add(mediaTypeDocId(i.mediaType, i.tmdbId));
    for (const n of ni) s.add(mediaTypeDocId(n.mediaType, n.tmdbId));
    return s;
  }, [items, ni]);

  if (!id || !spec) {
    return (
      <div>
        <Button
          onClick={goBack}
          variant="ghost" size="sm" className="inline-flex items-center gap-1 mb-3"
        >
          <ChevronLeft size={14} /> Tillbaka till rekommendationer
        </Button>
        <p className="text-sm text-ink-3">Raden hittades inte. Den kan ha försvunnit när dina betyg ändrades.</p>
      </div>
    );
  }

  return (
    <>
      <Button
        onClick={goBack}
        variant="ghost" size="sm" className="inline-flex items-center gap-1 mb-3"
      >
        <ChevronLeft size={14} /> Tillbaka till rekommendationer
      </Button>
      <PageHeader
        crumb="Rekommendationer"
        title={spec.label}
        standfirst={spec.description ?? undefined}
      />

      <RecommendationsFilters
        filters={filters}
        onChange={setFilters}
        onClearAll={clearAll}
        hasMyProviders={cascade.hasMyProviders}
      />

      {niLoading ? (
        // Vänta på "inte intresserad"-listan innan gridden renderas — annars
        // blinkar avfärdade titlar in tills snapshotten landat (BIN-37).
        <LoadingView variant="grid" label="Laddar rekommendationer…" />
      ) : (
        <RowRefinementContext.Provider value={refinement}>
        <ClearFiltersContext.Provider value={activeRecFilterCount(filters) > 0 ? clearAll : null}>
        <ExpandedDispatch
          spec={spec}
          excludedIds={excludedIds}
          filters={filters}
          myProviders={user?.myProviders ?? []}
          topGenreIds={cascade.topGenreIds}
          hiddenCountries={user?.hiddenCountries ?? []}
          latestFiveStar={cascade.latestFiveStar}
        />
        </ClearFiltersContext.Provider>
        </RowRefinementContext.Provider>
      )}
    </>
  );
}

interface DispatchProps {
  spec: RowSpec;
  excludedIds: ReadonlySet<string>;
  filters: FilterState;
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
    case 'free-public': return <FreePublicExpanded {...props} />;
    case 'companion':   return <CompanionExpanded {...props} />;
  }
}

function TrendingExpanded({ spec, excludedIds, filters }: DispatchProps) {
  const r = useRowTrending(spec, excludedIds, filters);
  return <ResultGrid result={r} />;
}

function LatestFavExpanded({ spec, excludedIds, filters, latestFiveStar }: DispatchProps) {
  const seed = latestFiveStar ? { tmdbId: latestFiveStar.tmdbId, mediaType: latestFiveStar.mediaType } : null;
  const r = useRowLatestFav(spec, seed, excludedIds, filters);
  return <ResultGrid result={r} />;
}

function SimilarExpanded({ spec, excludedIds, filters }: DispatchProps) {
  const r = useRowSimilar(spec, excludedIds, filters);
  return <ResultGrid result={r} />;
}

function PersonExpanded({ spec, excludedIds, filters }: DispatchProps) {
  const r = useRowPerson(spec, excludedIds, filters);
  return <ResultGrid result={r} />;
}

function GenreExpanded({ spec, excludedIds, filters }: DispatchProps) {
  const r = useRowGenreCanon(spec, excludedIds, filters);
  return <ResultGrid result={r} />;
}

function ThematicExpanded({ spec, excludedIds, filters }: DispatchProps) {
  const r = useRowThematic(spec, excludedIds, filters);
  return <ResultGrid result={r} />;
}

function UpcomingExpanded({ spec, excludedIds, filters, myProviders, topGenreIds }: DispatchProps) {
  const r = useRowUpcoming(spec, myProviders, topGenreIds, excludedIds, filters);
  return <ResultGrid result={r} />;
}

function FreePublicExpanded({ spec, excludedIds, filters }: DispatchProps) {
  const r = useRowFreePublic(spec, excludedIds, filters);
  return <ResultGrid result={r} />;
}

// BIN-583. No cross-row dedup here: the expanded view renders exactly one row,
// so there is no sibling row for a companion film to collide with.
function CompanionExpanded({ spec, excludedIds, filters }: DispatchProps) {
  const r = useRowCompanion(spec, excludedIds, filters);
  return <ResultGrid result={r} />;
}
