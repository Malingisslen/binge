'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
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
import { useRowFreePublic } from '@/hooks/rows/useRowFreePublic';
import { useRowCompanion } from '@/hooks/rows/useRowCompanion';
import RecRow from './RecRow';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { LoadingView } from '@/components/ui/LoadingView';
import RecommendationsFilters from './RecommendationsFilters';
import EmptyState from './EmptyState';
import QuickRateModal from './QuickRateModal';
import { RowExhaustionContext, type ReportExhaustion } from './rowExhaustionContext';
import { demoteExhaustedRows } from '@/lib/recommendations/rowComposition';
import { rowMatchesMediaFilter } from '@/lib/recommendations/rowMediaFilter';
import { companionFilmKeys } from '@/lib/recommendations/companionSeeds';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import { DEFAULT_FILTERS } from '@/types';
import type { FilterState, RowSpec, MediaTypeFilter } from '@/types';

const INITIAL_VISIBLE_ROWS = 5;

const MEDIA_TABS: ReadonlyArray<{ value: MediaTypeFilter; label: string }> = [
  { value: 'all', label: 'Alla' },
  { value: 'movie', label: 'Filmer' },
  { value: 'tv', label: 'Serier' },
];

export default function RecommendationsHub() {
  const cascade = useRecommendationsCascade();
  const { items, loading: watchlistLoading } = useWatchlist();
  const { items: ni, loading: niLoading } = useNotInterested();
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
    // BIN-560 Phase 4: composite-keyed (mediaTypeDocId) — see RecommendationsExpanded.
    const s = new Set<string>();
    for (const i of items) s.add(mediaTypeDocId(i.mediaType, i.tmdbId));
    for (const n of ni) s.add(mediaTypeDocId(n.mediaType, n.tmdbId));
    return s;
  }, [items, ni]);

  // BIN-583 cross-row dedup (binding condition of the #28 panel critique): a
  // curated companion film is reachable from the same `mina`-TV seed pool as
  // similar/latest-fav/upcoming, and dedupeAndExclude only dedupes WITHIN a row.
  // So the companion row keeps the film — it's the row that explains why it's
  // there — and every OTHER row treats it as excluded for this pass.
  const excludedIdsOtherRows = useMemo(() => {
    const companionKeys = companionFilmKeys(
      cascade.rows.flatMap(r => (r.id.kind === 'companion' ? r.meta?.companions ?? [] : [])),
    );
    if (companionKeys.size === 0) return excludedIds;
    const s = new Set(excludedIds);
    for (const k of companionKeys) s.add(k);
    return s;
  }, [cascade.rows, excludedIds]);

  // Rows report "tapped out" (pool fully rotated, or emptied by exclusions);
  // we sink those down the cascade so a fresher row rises into view.
  const [exhaustedRows, setExhaustedRows] = useState<ReadonlySet<string>>(() => new Set());
  const reportExhaustion = useCallback<ReportExhaustion>((rowKey, exhausted) => {
    setExhaustedRows(prev => {
      if (prev.has(rowKey) === exhausted) return prev;
      const next = new Set(prev);
      if (exhausted) next.add(rowKey);
      else next.delete(rowKey);
      return next;
    });
  }, []);

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
  const orderedRows = useMemo(
    () => demoteExhaustedRows(filteredRows, exhaustedRows),
    [filteredRows, exhaustedRows],
  );
  const visibleRows = orderedRows.slice(0, visibleRowCount);
  const hiddenCountries = user?.hiddenCountries ?? [];
  const myProviders = user?.myProviders ?? [];

  // R1: prioritizeRows körs om för varje detail/keyword-query som löser —
  // person-rader dyker upp och numreringen skiftar mitt under laddning.
  // Rendera inte numrerade rader förrän detektionen är stabil: watchlisten
  // har landat OCH alla detektions-queries (credits + keywords) avgjorts.
  // Då körs prioriteringen en gång på komplett data och ordningen är fast.
  const rowsPending = watchlistLoading || cascade.isLoadingDetection || niLoading;

  return (
    <>
      <header>
        <div className="crumb">Rekommendationer{rowsPending ? '' : ` · ${filteredRows.length} rader`}</div>
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
      <QuickRateModal open={quickRateOpen} onClose={() => setQuickRateOpen(false)} />

      {rowsPending ? (
        <LoadingView variant="grid" label="Laddar rekommendationer…" />
      ) : (
        <>
          <EmptyState ratingCount={cascade.ratingCount} onOpenQuickRate={() => setQuickRateOpen(true)} />

          <RowExhaustionContext.Provider value={reportExhaustion}>
            {visibleRows.map((spec, idx) => (
              <RowDispatch
                key={spec.rowKey}
                spec={spec}
                index={idx}
                excludedIds={excludedIds}
                excludedIdsOtherRows={excludedIdsOtherRows}
                filters={filters}
                myProviders={myProviders}
                topGenreIds={cascade.topGenreIds}
                hiddenCountries={hiddenCountries}
                latestFiveStar={cascade.latestFiveStar}
              />
            ))}
          </RowExhaustionContext.Provider>

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
      )}
    </>
  );
}

interface DispatchProps {
  spec: RowSpec;
  index: number;
  excludedIds: ReadonlySet<string>;
  /** excludedIds ∪ the companion row's films — see the cross-row dedup note above. */
  excludedIdsOtherRows: ReadonlySet<string>;
  filters: FilterState;
  myProviders: number[];
  topGenreIds: number[];
  hiddenCountries: string[];
  latestFiveStar: { tmdbId: number; mediaType: 'movie' | 'tv'; daysSince: number } | null;
}

function RowDispatch(props: DispatchProps) {
  const { spec } = props;
  // The companion row owns its films this pass; every other row gets them as an
  // exclusion so a title can't appear twice on the page (BIN-583).
  const p: DispatchProps = spec.id.kind === 'companion'
    ? props
    : { ...props, excludedIds: props.excludedIdsOtherRows };
  switch (spec.id.kind) {
    case 'trending':    return <TrendingRow {...p} />;
    case 'latest-fav':  return <LatestFavRow {...p} />;
    case 'similar':     return <SimilarRow {...p} />;
    case 'person':      return <PersonRow {...p} />;
    case 'genre-canon': return <GenreCanonRow {...p} />;
    case 'thematic':    return <ThematicRow {...p} />;
    case 'upcoming':    return <UpcomingRow {...p} />;
    case 'free-public': return <FreePublicRow {...p} />;
    case 'companion':   return <CompanionRow {...p} />;
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

function FreePublicRow({ spec, index, excludedIds, filters }: DispatchProps) {
  const r = useRowFreePublic(spec, excludedIds, filters);
  return <RecRow result={r} index={index} />;
}

function CompanionRow({ spec, index, excludedIds, filters }: DispatchProps) {
  const r = useRowCompanion(spec, excludedIds, filters);
  return <RecRow result={r} index={index} />;
}
