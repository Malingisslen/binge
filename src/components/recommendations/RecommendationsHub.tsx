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
import RecRow from './RecRow';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
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
      <header>
        <div className="crumb">Rekommendationer · {filteredRows.length} rader</div>
        <h1 className="page-h1">Vad du kan se — och varför.</h1>
        <p className="stand">
          Sju kategorier sorterade efter vad du har tittat på senast. Varje rad
          säger varför den finns där; tryck <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>visa fler</strong> för
          en utvidgad vy. Inga mystery-rader.
        </p>
      </header>

      <div className="rec-filters">
        {MEDIA_TABS.map(t => (
          <button
            key={t.value}
            type="button"
            onClick={() => setFilters(f => ({ ...f, mediaType: t.value }))}
            className={`chip${filters.mediaType === t.value ? ' is-on' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <RecommendationsFilters filters={filters} onChange={setFilters} hasMyProviders={cascade.hasMyProviders} />
      <EmptyState ratingCount={cascade.ratingCount} onOpenQuickRate={() => setQuickRateOpen(true)} />
      <QuickRateModal open={quickRateOpen} onClose={() => setQuickRateOpen(false)} />

      {visibleRows.map((spec, idx) => (
        <RowDispatch
          key={spec.rowKey}
          spec={spec}
          index={idx}
          excludedIds={excludedIds}
          filters={filters}
          myProviders={myProviders}
          topGenreIds={cascade.topGenreIds}
          hiddenCountries={hiddenCountries}
          latestFiveStar={cascade.latestFiveStar}
        />
      ))}

      {visibleRowCount < filteredRows.length && (
        <button
          onClick={() => setVisibleRowCount(c => c + 2)}
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 24 }}
        >
          Visa fler rader ›
        </button>
      )}
      {filteredRows.length === 0 && cascade.rows.length > 0 && (
        <p className="stand" style={{ marginTop: 24 }}>
          Inga {filters.mediaType === 'movie' ? 'filmer' : 'serier'} matchar dina filter. Justera ovan eller rensa.
        </p>
      )}

      {visibleRows.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <JustWatchCredit />
        </div>
      )}
    </>
  );
}

interface DispatchProps {
  spec: RowSpec;
  index: number;
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

function TrendingRow({ spec, index, excludedIds, filters }: DispatchProps) {
  const r = useRowTrending(spec, excludedIds, filters);
  return <RecRow result={r} index={index} />;
}

function LatestFavRow({ spec, index, excludedIds, filters, latestFiveStar }: DispatchProps) {
  const seed = latestFiveStar ? { tmdbId: latestFiveStar.tmdbId, mediaType: latestFiveStar.mediaType } : null;
  const r = useRowLatestFav(spec, seed, excludedIds, filters);
  return <RecRow result={r} index={index} />;
}

function SimilarRow({ spec, index, excludedIds, filters }: DispatchProps) {
  const r = useRowSimilar(spec, excludedIds, filters);
  return <RecRow result={r} index={index} />;
}

function PersonRow({ spec, index, excludedIds, filters }: DispatchProps) {
  const r = useRowPerson(spec, excludedIds, filters);
  return <RecRow result={r} index={index} />;
}

function GenreCanonRow({ spec, index, excludedIds, filters }: DispatchProps) {
  const r = useRowGenreCanon(spec, excludedIds, filters);
  return <RecRow result={r} index={index} />;
}

function ThematicRow({ spec, index, excludedIds, filters }: DispatchProps) {
  const r = useRowThematic(spec, excludedIds, filters);
  return <RecRow result={r} index={index} />;
}

function UpcomingRow({ spec, index, excludedIds, filters, myProviders, topGenreIds }: DispatchProps) {
  const r = useRowUpcoming(spec, myProviders, topGenreIds, excludedIds, filters);
  return <RecRow result={r} index={index} />;
}
