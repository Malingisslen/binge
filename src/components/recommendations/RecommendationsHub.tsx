'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
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
import type { FilterState, RowSpec, MediaTypeFilter } from '@/types';

const INITIAL_VISIBLE_ROWS = 5;

const MEDIA_TABS: ReadonlyArray<{ value: MediaTypeFilter; label: string }> = [
  { value: 'all', label: 'Alla' },
  { value: 'movie', label: 'Filmer' },
  { value: 'tv', label: 'Serier' },
];

/**
 * Filtrera bort medie-låsta rader (similar, latest-fav) vars seed-medietyp
 * inte matchar aktivt mediatyp-filter. Andra rad-typer hanterar sin egen
 * mediatyp inifrån (genre-canon/thematic/upcoming gör parallel-fetch;
 * trending/person filtrerar per titel klient-sidigt).
 */
function rowMatchesMediaFilter(
  spec: RowSpec,
  mediaType: MediaTypeFilter,
  latestFiveStar: { mediaType: 'movie' | 'tv' } | null,
): boolean {
  if (mediaType === 'all') return true;
  if (spec.id.kind === 'similar') return spec.id.mediaType === mediaType;
  if (spec.id.kind === 'latest-fav') return latestFiveStar?.mediaType === mediaType;
  return true;
}

export default function RecommendationsHub() {
  const cascade = useRecommendationsCascade();
  const { items } = useWatchlist();
  const { items: ni } = useNotInterested();
  const { user } = useAuth();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [quickRateOpen, setQuickRateOpen] = useState(false);
  const [visibleRowCount, setVisibleRowCount] = useState(INITIAL_VISIBLE_ROWS);

  // Synka user-prefs (hideNonLatin, hiddenCountries) in i filter när profil läses.
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

  const scrollThrottleRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const onScroll = () => {
      if (scrollThrottleRef.current) return;
      scrollThrottleRef.current = setTimeout(() => {
        const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 800;
        if (nearBottom) setVisibleRowCount(c => Math.min(c + 2, cascade.rows.length));
        scrollThrottleRef.current = null;
      }, 150);
    };
    window.addEventListener('scroll', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (scrollThrottleRef.current) clearTimeout(scrollThrottleRef.current);
    };
  }, [cascade.rows.length]);

  const filteredRows = useMemo(
    () => cascade.rows.filter(spec => rowMatchesMediaFilter(spec, filters.mediaType, cascade.latestFiveStar)),
    [cascade.rows, filters.mediaType, cascade.latestFiveStar],
  );
  const visibleRows = filteredRows.slice(0, visibleRowCount);
  const hiddenCountries = user?.hiddenCountries ?? [];
  const myProviders = user?.myProviders ?? [];

  return (
    <>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h1 className="text-[18px] font-bold text-text-primary">För dig</h1>
        <p className="text-xs text-text-muted">Baserat på dina ratings, exklusive det du redan följer.</p>
      </div>

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

      {visibleRowCount < filteredRows.length && (
        <button onClick={() => setVisibleRowCount(c => c + 2)} className="text-xs text-accent mt-2">Visa fler rader ›</button>
      )}
      {filteredRows.length === 0 && cascade.rows.length > 0 && (
        <p className="text-sm text-text-muted py-4">Inga {filters.mediaType === 'movie' ? 'filmer' : 'serier'} i nuvarande rekommendationer. Byt mediatyp eller justera filter.</p>
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

function TrendingRow({ spec, excludedIds, filters }: DispatchProps) {
  const r = useRowTrending(spec, excludedIds, filters);
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
