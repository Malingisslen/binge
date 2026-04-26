'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRecommendationsCascade } from '@/hooks/useRecommendationsCascade';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useNotInterested } from '@/hooks/useNotInterested';
import { useAuth } from '@/hooks/useAuth';
import { useRowTrending } from '@/hooks/rows/useRowTrending';
import { useRowLatestFav } from '@/hooks/rows/useRowLatestFav';
import { useRowSimilar } from '@/hooks/rows/useRowSimilar';
import { useRowPerson } from '@/hooks/rows/useRowPerson';
import { useRowGenreCanon } from '@/hooks/rows/useRowGenreCanon';
import { useRowThematic } from '@/hooks/rows/useRowThematic';
import { useRowUpcoming } from '@/hooks/rows/useRowUpcoming';
import CascadeRow from './CascadeRow';
import RecommendationsFilters from './RecommendationsFilters';
import EmptyState from './EmptyState';
import QuickRateModal from './QuickRateModal';
import { DEFAULT_FILTERS } from '@/types';
import type { FilterState, RowSpec, RowResult } from '@/types';

const INITIAL_VISIBLE_ROWS = 5;

export default function RecommendationsHub() {
  const cascade = useRecommendationsCascade();
  const { items } = useWatchlist();
  const { items: ni } = useNotInterested();
  const { user } = useAuth();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [quickRateOpen, setQuickRateOpen] = useState(false);
  const [visibleRowCount, setVisibleRowCount] = useState(INITIAL_VISIBLE_ROWS);

  const excludedIds = useMemo(() => {
    const s = new Set<number>();
    for (const i of items) s.add(i.tmdbId);
    for (const n of ni) s.add(n.tmdbId);
    return s;
  }, [items, ni]);

  useEffect(() => {
    const onScroll = () => {
      const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 800;
      if (nearBottom) setVisibleRowCount(c => Math.min(c + 2, cascade.rows.length));
    };
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, [cascade.rows.length]);

  const visibleRows = cascade.rows.slice(0, visibleRowCount);
  const hiddenCountries = user?.hiddenCountries ?? [];
  const myProviders = user?.myProviders ?? [];

  return (
    <>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h1 className="text-[18px] font-bold text-text-primary">För dig</h1>
        <p className="text-xs text-text-muted">Baserat på dina ratings, exklusive det du redan följer.</p>
      </div>

      <RecommendationsFilters filters={filters} onChange={setFilters} hasMyProviders={cascade.hasMyProviders} />
      <EmptyState ratingCount={cascade.ratingCount} onOpenQuickRate={() => setQuickRateOpen(true)} />
      <QuickRateModal open={quickRateOpen} onClose={() => setQuickRateOpen(false)} />

      {visibleRows.map(spec => (
        <RowDispatch
          key={spec.rowKey}
          spec={spec}
          excludedIds={excludedIds}
          filters={filters}
          myProviders={myProviders}
          topGenreIds={cascade.topGenreIds}
          hiddenCountries={hiddenCountries}
          latestFiveStar={cascade.latestFiveStar}
        />
      ))}

      {visibleRowCount < cascade.rows.length && (
        <button onClick={() => setVisibleRowCount(c => c + 2)} className="text-xs text-accent mt-2">Visa fler rader ›</button>
      )}
    </>
  );
}

interface DispatchProps {
  spec: RowSpec;
  excludedIds: ReadonlySet<number>;
  filters: FilterState;
  myProviders: number[];
  topGenreIds: number[];
  hiddenCountries: string[];
  latestFiveStar: { tmdbId: number; mediaType: 'movie' | 'tv'; daysSince: number } | null;
}

function RowDispatch(props: DispatchProps) {
  const { spec } = props;
  switch (spec.id.kind) {
    case 'trending':    return <TrendingRow {...props} />;
    case 'latest-fav':  return <LatestFavRow {...props} />;
    case 'similar':     return <SimilarRow {...props} />;
    case 'person':      return <PersonRow {...props} />;
    case 'genre-canon': return <GenreCanonRow {...props} />;
    case 'thematic':    return <ThematicRow {...props} />;
    case 'upcoming':    return <UpcomingRow {...props} />;
  }
}

function TrendingRow({ spec, excludedIds, filters, hiddenCountries }: DispatchProps) {
  const r = useRowTrending(spec, excludedIds, filters, hiddenCountries);
  return <CascadeRow result={r} />;
}

function LatestFavRow({ spec, excludedIds, filters, latestFiveStar }: DispatchProps) {
  const seed = latestFiveStar ? { tmdbId: latestFiveStar.tmdbId, mediaType: latestFiveStar.mediaType } : null;
  const r = useRowLatestFav(spec, seed, excludedIds, filters);
  return <CascadeRow result={r} />;
}

function SimilarRow({ spec, excludedIds, filters }: DispatchProps) {
  const r = useRowSimilar(spec, excludedIds, filters);
  return <CascadeRow result={r} />;
}

function PersonRow({ spec, excludedIds, filters }: DispatchProps) {
  const r = useRowPerson(spec, excludedIds, filters);
  return <CascadeRow result={r} />;
}

function GenreCanonRow({ spec, excludedIds, filters }: DispatchProps) {
  const r = useRowGenreCanon(spec, excludedIds, filters);
  return <CascadeRow result={r} />;
}

function ThematicRow({ spec, excludedIds, filters }: DispatchProps) {
  const r = useRowThematic(spec, excludedIds, filters);
  return <CascadeRow result={r} />;
}

function UpcomingRow({ spec, excludedIds, filters, myProviders, topGenreIds }: DispatchProps) {
  const r = useRowUpcoming(spec, myProviders, topGenreIds, excludedIds, filters);
  return <CascadeRow result={r} />;
}
