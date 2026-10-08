'use client';

import { Suspense, useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import {
  Search, Film, Tv, X, Check, ChevronDown, Library,
  Rows3, LayoutGrid, Grid3x3, CloudOff,
} from 'lucide-react';
import { posterUrl, posterSrcSet, titleHref } from '@/lib/tmdb/client';
import { getProvider } from '@/lib/tmdb/providers';
import { seenDate } from '@/lib/seenDate';
import ProviderDot from '@/components/ui/ProviderDot';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { LoadingView } from '@/components/ui/LoadingView';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { useCalendarEntries } from '@/hooks/useCalendar';
import { useSubscriptionAdvisor } from '@/hooks/useSubscriptionAdvisor';
import RatingStars from '@/components/title/RatingStars';
import {
  ProviderChips,
  PosterProviderDots,
} from '@/components/watchlist/WatchlistProviderDisplay';
import { WatchlistCard } from '@/components/watchlist/WatchlistCard';
import {
  FollowingCardSections,
  bucketBySubState,
  CARD_GRID_CLASS,
} from '@/components/watchlist/FollowingCardSections';
import {
  librarySubState,
  buildStandfirst,
  itemPassesLibraryFilters,
  genreOptionsInLibrary,
  serviceCountsInLibrary,
  sanitizeLibraryFilters,
  tagsInLibrary,
  DEFAULT_LIBRARY_FILTERS,
  LIBRARY_SUB_STATE_ORDER,
  type LibraryFilters,
} from '@/lib/libraryView';
import { countSharedFilters, formatStars, genreIdsOf, wantedProviderIds, withoutEmptyMine, yearCeiling } from '@/lib/filters/titleFilters';
import {
  ActiveFilterChips,
  FilterPanel,
  FilterToggle,
  FilteredEmptyState,
  sharedChipsFor,
} from '@/components/filters/TitleFilters';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useLibraryRuntimes } from '@/hooks/useLibraryRuntimes';
import { formatLibraryDate, pluralSv } from '@/lib/utils';
import { toneForId } from '@/lib/duotone';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import { useIncrementalList } from '@/hooks/useIncrementalList';
import { useClickOutside } from '@/hooks/useClickOutside';
import {
  LIBRARY_UNREACHABLE_TITLE,
  LIBRARY_UNREACHABLE_BODY,
  LIBRARY_RETRY_LABEL,
} from '@/lib/watchlist/libraryHoldCopy';
import type { WatchStatus, WatchlistItem } from '@/types';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { eyebrowClass } from '@/components/ui/Eyebrow';
import { thClass } from '@/components/ui/tableHead';
import { cardClass } from '@/components/ui/Card';
import { compareTitles } from '@/lib/titleSort';

// BIN-560 Phase 4: selection/next-air state is keyed by the composite doc id
// `mediaTypeDocId(mediaType, tmdbId)`, not bare tmdbId — a movie and a TV show
// sharing a tmdbId must not share a checkbox, a next-air date, or a bulk action.
const keyOf = (i: Pick<WatchlistItem, 'mediaType' | 'tmdbId'>) => mediaTypeDocId(i.mediaType, i.tmdbId);

type SortKey = 'updatedAt' | 'addedAt' | 'watchedAt' | 'title' | 'rating' | 'releaseYear';

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return formatLibraryDate(d);
}

// Sedd-kolumnen och "Sedd datum"-sorteringen visas även i den ofiltrerade /my/all-vyn,
// så utan status-grinden i `seenDate` skulle ett sett-datum plötsligt stå bredvid en rad
// som är märkt "Avbruten" eller "Vill se". Regeln och dess skäl bor i src/lib/seenDate.ts
// sedan BIN-689 — den låg tidigare handkopierad här och på fyra andra ytor.
type ViewMode = 'table' | 'grid' | 'cards';
type MediaFilter = 'all' | 'movie' | 'tv';

// Stabil tom referens — behind-settet appliceras i EN re-bucketing när
// advisorn settlat (X1: ingen gradvis sektionsmigration medan TV-detaljqueries
// löser en och en).
const EMPTY_BEHIND = new Set<number>();

interface WatchlistPageProps {
  status?: WatchStatus;
  title: string;
}

export default function WatchlistPage(props: WatchlistPageProps) {
  return (
    <Suspense fallback={null}>
      <WatchlistPageInner {...props} />
    </Suspense>
  );
}

function WatchlistPageInner({ status, title }: WatchlistPageProps) {
  const {
    items, loading: watchlistLoading, listenerFailed, retryListener,
    removeItem, updateStatus, updateRating,
  } = useWatchlist();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const providerParam = Number(searchParams.get('provider'));
  const providerFilterId = Number.isFinite(providerParam) && providerParam > 0 ? providerParam : null;
  const providerFilter = providerFilterId != null ? getProvider(providerFilterId) : undefined;
  // ?status=behind aktiveras från Streamingrådgivarens catchup-kort. Behöver
  // bara meningsfullt agera på /my/series — andra listor har inte
  // koncept av "ligger efter på aireade avsnitt". useSubscriptionAdvisor
  // delar TMDB-cache med useCalendarEntries så ingen extra fetch.
  const behindFilterActive = status === 'mina' && searchParams.get('status') === 'behind';
  // Rådgivaren behövs bara på /my/series ('mina'): för sub-state-sektionering
  // och "ligger efter"-filtret. På övriga bibliotekssidor används dess output
  // inte — gate så den inte fan-out:ar TV-detaljqueries i onödan.
  const advisor = useSubscriptionAdvisor(60, { enabled: status === 'mina' });
  const behindIds = behindFilterActive ? advisor.unfinishedTmdbIds : null;
  const clearProviderFilter = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('provider');
    params.delete('status');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };
  const clearBehindFilter = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('status');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [sort, setSort] = useState<SortKey>('updatedAt');
  // Filters survive a reload, per library view.
  const [storedLibFilters, setLibFiltersRaw] = usePersistedState<LibraryFilters>(
    `binge:filters:library:${status ?? 'all'}`, DEFAULT_LIBRARY_FILTERS, sanitizeLibraryFilters,
  );
  const showAddedCol = status !== 'sedd';
  const showWatchedCol = status === 'sedd' || !status;
  // B10/B14: /my/series ('mina') och /my/films ('sedd') kan per schema bara
  // innehålla en medietyp — där är både TYP-kolumnen och medietyps-chipsen
  // redundanta. Mixade vyer (vill_se/avbruten/all) behåller båda.
  const singleMediaStatus = status === 'mina' || status === 'sedd';
  const showTypeCol = !singleMediaStatus && mediaFilter === 'all';
  // Bas: checkbox, poster, titel, år, tjänster, betyg = 6 kolumner.
  const tableColCount =
    6 + (showTypeCol ? 1 : 0) + (showAddedCol ? 1 : 0) + (showWatchedCol ? 1 : 0);
  const [view, setView] = useState<ViewMode>(status === 'mina' ? 'cards' : 'grid');
  // Composite doc-id keys (mediaTypeDocId), not bare tmdbId — see keyOf above.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // BIN-153: bulk-åtgärder (Ta bort / Flytta) får ALDRIG röra titlar som är
  // bortfiltrerade av sök/filter. Bekräftelse innan radering (data-loss). We
  // snapshot the actual items so the delete carries mediaType + tmdbId.
  const [confirmDelete, setConfirmDelete] = useState<WatchlistItem[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  // BIN-42: "Välj"-läge togglar kryssrutor i kort/rutnät (tabellen har egna).
  const [selectMode, setSelectMode] = useState(false);
  const toggleSelect = (key: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const [searchQuery, setSearchQuery] = useState('');
  // The panel holds the axes shared with Rekommendationer plus Status (on "Allt") and Taggar.
  const [filterOpen, setFilterOpen] = useState(false);
  // A filter change can hide selected titles; bulk actions must never reach them (BIN-153).
  const setLibFilters = (next: LibraryFilters) => { setLibFiltersRaw(next); setSelected(new Set()); };
  const myProviders = useMemo(() => user?.myProviders ?? [], [user?.myProviders]);
  // A saved "Mina tjänster" from before the user removed every service would filter nothing.
  const libFilters = useMemo(
    () => withoutEmptyMine(storedLibFilters, myProviders),
    [storedLibFilters, myProviders],
  );
  const activeFilterCount = countSharedFilters(libFilters) + libFilters.tags.length + (libFilters.status ? 1 : 0);
  const clearAllFilters = () => {
    setLibFilters(DEFAULT_LIBRARY_FILTERS);
    setSearchQuery('');
  };
  const wantedProviders = useMemo(() => wantedProviderIds(libFilters, myProviders), [libFilters, myProviders]);
  const selectedGenreIds = useMemo(() => genreIdsOf(libFilters.genres), [libFilters.genres]);
  const { entries: calendarEntries } = useCalendarEntries();
  const nextAirByTmdbId = useMemo(() => {
    // Composite-keyed (mediaTypeDocId): calendarEntries mix TV episode air-dates
    // and movie release-dates, so a movie/TV tmdbId clash must not collide here.
    const m = new Map<string, string>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const e of calendarEntries) {
      if (new Date(e.airDate) < today) continue;
      const key = mediaTypeDocId(e.mediaType, e.tmdbId);
      const prev = m.get(key);
      if (!prev || e.airDate < prev) m.set(key, e.airDate);
    }
    return m;
  }, [calendarEntries]);

  useEffect(() => {
    // B15 (works-as-designed): /my/series öppnar alltid i Kort-vyn oavsett
    // användarens defaultView-inställning. Kort är den enda vyn med
    // sub-state-sektionsrubriker (Ligger efter/Påbörjade/…) — det är vyn som
    // gör Följer-listan aktionerbar. Tabell/Rutnät får samma gruppordning
    // (se displayItems) men utan rubriker. Medvetet undantag — ska inte
    // flaggas som bugg i framtida audits.
    if (status === 'mina') return;
    if (user?.defaultView) setView(user.defaultView);
  }, [user?.defaultView, status]);

  const baseItems = useMemo(
    () => status ? items.filter(i => i.status === status && (status !== 'mina' || !i.dropped)) : items,
    [items, status],
  );
  const { runtimeOf, pending: runtimesPending } = useLibraryRuntimes(baseItems, !!libFilters.length);

  const filtered = useMemo(() => {
    let result = baseItems;
    if (mediaFilter !== 'all') {
      result = result.filter(i => i.mediaType === mediaFilter);
    }
    if (providerFilterId != null) {
      result = result.filter(i => i.providers.includes(providerFilterId));
    }
    result = result.filter(i => itemPassesLibraryFilters(i, libFilters, {
      genreIds: selectedGenreIds,
      wantedProviders,
      runtime: libFilters.length ? runtimeOf(i) : null,
    }));
    if (behindIds) {
      result = result.filter(i => behindIds.has(i.tmdbId));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i => i.title.toLowerCase().includes(q));
    }
    result = [...result].sort((a, b) => {
      switch (sort) {
        case 'title': return compareTitles(a.title, b.title);
        case 'rating': return (b.rating ?? 0) - (a.rating ?? 0);
        case 'releaseYear': return (b.releaseYear ?? 0) - (a.releaseYear ?? 0);
        case 'addedAt': return b.addedAt.getTime() - a.addedAt.getTime();
        case 'watchedAt': return (seenDate(b)?.getTime() ?? 0) - (seenDate(a)?.getTime() ?? 0);
        default: return b.updatedAt.getTime() - a.updatedAt.getTime();
      }
    });
    return result;
  }, [baseItems, mediaFilter, sort, searchQuery, providerFilterId, libFilters, selectedGenreIds, wantedProviders, runtimeOf, behindIds]);

  // Genrer som finns i denna lista (base-filtrerad på status) → filterchips
  // visar bara relevanta val och försvinner inte när man filtrerar (BIN-44).
  const availableGenres = useMemo(() => genreOptionsInLibrary(baseItems), [baseItems]);
  const availableServices = useMemo(
    () => serviceCountsInLibrary(baseItems, id => getProvider(id)?.shortName),
    [baseItems],
  );

  // BIN-164: taggarna som faktiskt finns i denna lista → filterchips (döljs helt
  // när inga taggar finns, samma mönster som genre).
  const availableTags = useMemo(() => tagsInLibrary(baseItems), [baseItems]);

  const totalCount = useMemo(
    () => status
      ? items.filter(i => i.status === status && (status !== 'mina' || !i.dropped)).length
      : items.length,
    [items, status]
  );

  // B7/T2: substate för /my/series härleds från PERSISTERADE fält enbart
  // (kontraktet bor i src/lib/libraryView.ts) + advisorns behind-set som
  // "vet säkert bakom"-signal. Behind-settet bygger på TMDB-data som
  // useSubscriptionAdvisor/useCalendarEntries redan hämtat för andra syften
  // på den här sidan — INGEN extra TMDB-fan-out introduceras för substate.
  const subStateOf = useMemo(() => {
    const behind = advisor.isLoading ? EMPTY_BEHIND : advisor.unfinishedTmdbIds;
    const endedCaughtUp = advisor.isLoading ? EMPTY_BEHIND : advisor.endedCaughtUpTmdbIds;
    return (item: WatchlistItem) =>
      librarySubState(item, behind.has(item.tmdbId), endedCaughtUp.has(item.tmdbId));
  }, [advisor.isLoading, advisor.unfinishedTmdbIds, advisor.endedCaughtUpTmdbIds]);

  // B6: alla tre vyer (Kort/Tabell/Rutnät) visar samma gruppordning för
  // /my/series — ligger efter → pågående → ej påbörjade → avslutade, stabilt
  // sorterade inom gruppen enligt vald sortering. Kort-vyn lägger till
  // sektionsrubriker; Tabell/Rutnät får ordningen utan rubriker (minst
  // invasiva konsekventa designen — rubrikrader i en <table> är ett större
  // ingrepp än det är värt).
  const displayItems = useMemo(() => {
    if (status !== 'mina') return filtered;
    const rank = (i: WatchlistItem) =>
      i.mediaType !== 'tv'
        ? LIBRARY_SUB_STATE_ORDER.length
        : LIBRARY_SUB_STATE_ORDER.indexOf(subStateOf(i));
    return [...filtered].sort((a, b) => rank(a) - rank(b));
  }, [filtered, status, subStateOf]);

  // Inkrementell rendering: rita ~100 åt gången, avslöja fler vid scroll.
  // Nollställs vid filter/sortering (displayItems byter referens) så sökning
  // aldrig re-renderar hela biblioteket. Markeringslogik (select-all m.m.)
  // jobbar fortfarande mot hela displayItems — bara renderingen kapas.
  const { visible: visibleItems, hasMore, sentinelRef } = useIncrementalList(displayItems);

  // BIN-153: beskär markeringen till det som FAKTISKT syns när filter/sök ändras.
  // Annars kan en titel markeras, filtreras bort, och sen raderas av bulk-"Ta
  // bort" trots att den inte är synlig — och "N markerade" skulle överräkna.
  useEffect(() => {
    const visibleIds = new Set(displayItems.map(keyOf));
    setSelected(prev => {
      const next = new Set([...prev].filter(key => visibleIds.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [displayItems]);

  const followingSections = useMemo(() => {
    if (status !== 'mina') return null;
    const tvItems = displayItems.filter((i): i is WatchlistItem => i.mediaType === 'tv');
    return bucketBySubState(tvItems, subStateOf);
  }, [displayItems, status, subStateOf]);

  // På /my/series (status==='mina') renderas endast TV-titlar i sektionerna
  // (followingSections filtrerar bort movie-items). Räkna samma mängd i
  // standfirst så subtitle inte säger mer än sektionerna visar — och räkna
  // total mot samma TV-delmängd så "X av Y" stämmer vid sökning (B1/B5).
  const tvVisibleCount = useMemo(
    () => filtered.filter(i => i.mediaType === 'tv').length,
    [filtered]
  );
  const tvTotalCount = useMemo(
    () => items.filter(i => i.status === 'mina' && !i.dropped && i.mediaType === 'tv').length,
    [items]
  );
  const standfirst = status === 'mina'
    ? buildStandfirst(tvVisibleCount, tvTotalCount, status, mediaFilter)
    : buildStandfirst(filtered.length, totalCount, status, mediaFilter);

  const hasActiveFilters =
    mediaFilter !== 'all' ||
    !!providerFilter ||
    behindFilterActive ||
    activeFilterCount > 0 ||
    searchQuery.length > 0;
  const emptyMessage = hasActiveFilters
    ? 'Inga titlar matchar dina filter. Justera ovan eller rensa.'
    : totalCount === 0
      ? 'Inget i biblioteket än. Hitta något att titta på via Rekommendationer.'
      : 'Inga titlar i den här vyn. Pröva ett annat filter eller status ovan.';

  // B13: medan Firestore-snapshoten laddar är items tom — utan denna gate
  // blinkar tomma bibliotekets standfirst + empty-state innan titlarna
  // landar. Gäller alla biblioteksvyer (en delad komponent).
  //
  // X1-klass: /my/series sektionerar + ordnar på advisorns behind-set, som
  // bygger på TV-detaljqueries. Vi gatear INTE längre /my/series på
  // advisor.isLoading — sidan renderas direkt på persisterade fält
  // (librarySubState klarar knownBehind=false by design, behind-settet är
  // fryst till EMPTY_BEHIND medan advisorn laddar). När advisorn settlat sker
  // EN re-bucketing vid initial settle — ingen gradvis sektionsmigration medan
  // queries löser en och en. (Senare Firestore-snapshots kan trigga ytterligare
  // re-bucketings, men varje sådan är korrekt — inte den gradvisa flickern vi
  // undviker här.) Undantag: "ligger efter"-filtret (behindFilterActive) KRÄVER
  // behind-settet, annars visar vi en felaktigt tom filtrerad lista — där
  // behålls gaten. Övriga biblioteksvyer använder inte advisor-datat alls.
  if (watchlistLoading || (behindFilterActive && advisor.isLoading)) {
    return (
      <>
        <header>
          <div className="crumb">Bibliotek · {labelForStatus(status)}</div>
          <h1 className="page-h1">{title}</h1>
        </header>
        <LibrarySubnav status={status} />
        <LoadingView variant="grid" label="Laddar biblioteket…" />
      </>
    );
  }

  // BIN-700: a terminally dead listener. `loading` is false here and `items` is
  // empty — which, without this branch, renders as a confident "Inget i
  // biblioteket än" to someone who has 300 titles. That is the single worst
  // thing this view can say: it reads as "your data is gone".
  //
  // Deliberately a WHOLE-PAGE state, not a banner above the (empty) list: every
  // control below it — the bulk select-all, "Ta bort", the status filters —
  // operates on a list we know to be wrong, and a delete button next to nothing
  // is the confidently-empty library that got the first attempt at this reverted.
  // Ordered AFTER the loading branch so a retry in flight shows the spinner, not
  // the error it is busy trying to clear.
  if (listenerFailed) {
    return (
      <>
        <header>
          <div className="crumb">Bibliotek · {labelForStatus(status)}</div>
          <h1 className="page-h1">{title}</h1>
        </header>
        <LibrarySubnav status={status} />
        <div className="mt-4">
          <EmptyState
            icon={<CloudOff size={22} />}
            title={LIBRARY_UNREACHABLE_TITLE}
            body={LIBRARY_UNREACHABLE_BODY}
            action={
              <Button type="button" onClick={retryListener} variant="acc">
                {LIBRARY_RETRY_LABEL}
              </Button>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <header>
        <div className="crumb">
          Bibliotek · {labelForStatus(status)}{providerFilter ? ` · ${providerFilter.shortName}` : ''}{behindFilterActive ? ' · efter' : ''}
        </div>
        <h1 className="page-h1">{title}</h1>
        <p className="stand">{standfirst}</p>
      </header>

      <LibrarySubnav status={status} />

      {(providerFilter || behindFilterActive) && (
        <div className="chip acc" style={{ marginTop: 18, padding: '6px 12px', display: 'inline-flex', gap: 8 }}>
          <span className={eyebrowClass({ size: 'xs', tone: 'acc' })}>
            filter:
          </span>
          {providerFilter && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <ProviderDot color={providerFilter.color} size={7} />
              {providerFilter.shortName}
            </span>
          )}
          {behindFilterActive && <span>Ligger efter</span>}
          <button
            type="button"
            onClick={behindFilterActive && !providerFilter ? clearBehindFilter : clearProviderFilter}
            className="topbar-icon-btn"
            style={{ marginLeft: 4, color: 'var(--acc-deep)' }}
            aria-label="Rensa filter"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* B14: verktygsraden följer samma regelverk i alla biblioteksvyer:
          [medietyps-chips — bara där listan kan blanda serier+film]
          [sortdropdown — alltid] [sök — alltid när listan är > 10]
          [vytogglar — alltid]. /my/series och /my/films är enmediavyer
          (jfr B10) så chips vore döda knappar där — det är regeln, inte
          en inkonsekvens. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 22, flexWrap: 'wrap' }}>
        {!singleMediaStatus && (
          <Segmented
            ariaLabel="Filtrera på medietyp"
            value={mediaFilter}
            onChange={f => { setMediaFilter(f); setSelected(new Set()); }}
            options={[
              { value: 'all', label: 'Alla' },
              { value: 'tv', label: 'Serier' },
              { value: 'movie', label: 'Film' },
            ]}
          />
        )}

        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortKey)}
          aria-label="Sortera biblioteket"
          className="select"
        >
          <option value="updatedAt">Senast ändrad</option>
          <option value="title">Titel A-Ö</option>
          <option value="rating">Betyg</option>
          <option value="releaseYear">År</option>
          <option value="addedAt">Tillagd</option>
          {/* Samma villkor som Sedd-kolumnen: seenDate() ger null för allt som inte
              står som sedd, så i en vy utan sedda rader (t.ex. /my/avbrutna eller
              /my/series) vore det här valet en garanterad no-op. Erbjud det bara
              där det gör något. (Den gamla motiveringen "TV i 'mina' har aldrig
              watchedAt" gäller INTE längre — BIN-593 slutade rensa fältet, och
              migrateStatus kan mappa gamla TV-dokument till 'mina' med datumet
              kvar. Grinden är seenDate(), inte medietypen.) */}
          {showWatchedCol && <option value="watchedAt">Sedd datum</option>}
        </select>

        {totalCount > 10 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 10px',
            background: 'var(--surface)',
            border: '1px solid var(--rule)',
            borderRadius: 6,
          }}>
            <Search size={12} style={{ color: 'var(--ink-3)' }} />
            <input
              type="text"
              placeholder="sök titel…"
              aria-label="Sök i biblioteket"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              style={{
                background: 'transparent', border: 0,
                fontSize: 'var(--fs-xs)',
                color: 'var(--ink)', outline: 'none', width: 140,
              }}
            />
          </div>
        )}

        <div style={{ marginLeft: 'auto' }}>
          <FilterToggle open={filterOpen} activeCount={activeFilterCount} onToggle={() => setFilterOpen(o => !o)} />
        </div>

        <button
          type="button"
          onClick={() => { setSelectMode(m => !m); setSelected(new Set()); }}
          className={`chip${selectMode ? ' is-on' : ''}`}
        >
          {selectMode ? 'Klar' : 'Välj'}
        </button>
        <Segmented
          ariaLabel="Vyläge"
          value={view}
          onChange={setView}
          options={[
            { value: 'table', icon: <Rows3 size={15} />, title: 'Tabell' },
            { value: 'cards', icon: <LayoutGrid size={15} />, title: 'Kort' },
            { value: 'grid', icon: <Grid3x3 size={15} />, title: 'Rutnät' },
          ]}
        />
      </div>

      {filterOpen && (
        <FilterPanel
          value={libFilters}
          onChange={shared => setLibFilters({ ...libFilters, ...shared })}
          onClose={() => setFilterOpen(false)}
          genreOptions={availableGenres}
          services={availableServices}
          hasMyServices={myProviders.length > 0}
          yearCeiling={yearCeiling()}
          extra={
            <>
              {!status && (
                <div>
                  <label htmlFor="lib-status" className={`${eyebrowClass({ size: 'xs' })} block mb-1.5`}>Status</label>
                  <select
                    id="lib-status"
                    className="select w-full"
                    value={libFilters.status}
                    onChange={e => setLibFilters({ ...libFilters, status: e.target.value as WatchStatus | '' })}
                  >
                    <option value="">Alla statusar</option>
                    {STATUS_CHOICES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}
              {availableTags.length > 0 && (
                <fieldset className="col-span-full">
                  <legend className={`${eyebrowClass({ size: 'xs' })} mb-1.5`}>Taggar</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {availableTags.map(t => {
                      const on = libFilters.tags.includes(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          aria-pressed={on}
                          className={`chip${on ? ' is-on' : ''}`}
                          onClick={() => setLibFilters({
                            ...libFilters,
                            tags: on ? libFilters.tags.filter(x => x !== t) : [...libFilters.tags, t],
                          })}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
            </>
          }
        />
      )}

      <ActiveFilterChips
        chips={[
          ...(libFilters.status
            ? [{ key: 'status', label: STATUS_CHOICES.find(o => o.value === libFilters.status)?.label ?? '', onRemove: () => setLibFilters({ ...libFilters, status: '' }) }]
            : []),
          ...sharedChipsFor(libFilters, shared => setLibFilters({ ...libFilters, ...shared }), id => getProvider(id)?.shortName ?? `Tjänst ${id}`),
          ...libFilters.tags.map(t => ({
            key: `tag-${t}`,
            label: t,
            onRemove: () => setLibFilters({ ...libFilters, tags: libFilters.tags.filter(x => x !== t) }),
          })),
        ]}
        onClearAll={clearAllFilters}
      />
      {activeFilterCount > 0 && (
        <p className="text-xs text-ink-3 mt-2" aria-live="polite">
          {displayItems.length} av {baseItems.length} titlar
        </p>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-acc-deep/10 border border-acc-deep/20 rounded-sm">
          <span className="text-xs text-ink-2">{pluralSv(selected.size, 'markerad', 'markerade')}</span>
          {status === 'sedd' && (
            <Button
              onClick={async () => {
                await Promise.all(displayItems.filter(i => selected.has(keyOf(i))).map(i => updateStatus(i.mediaType, i.tmdbId, 'vill_se')));
                setSelected(new Set());
              }}
              variant="acc" size="sm"
            >
              Flytta till Vill se
            </Button>
          )}
          {/* BIN-168: bulk "Avbryt" på serievyn (/my/series). Avbruten är ett
              giltigt slutläge för serier man gett upp — tidigare gick bara att
              massradera dem, inte avbryta. Skopad till 'mina' så den inte dyker
              upp på sedda filmer (terminalt) eller redan avbrutna. */}
          {status === 'mina' && (
            <Button
              onClick={async () => {
                await Promise.all(displayItems.filter(i => selected.has(keyOf(i))).map(i => updateStatus(i.mediaType, i.tmdbId, 'avbruten')));
                setSelected(new Set());
              }}
              variant="ghost" size="sm"
              title="Markera valda serier som avbrutna"
            >
              Avbryt
            </Button>
          )}
          <Button
            onClick={() => { if (selected.size > 0) setConfirmDelete(displayItems.filter(i => selected.has(keyOf(i)))); }}
            variant="danger-ghost" size="xs"
          >
            Ta bort
          </Button>
          <Button
            onClick={() => setSelected(new Set())}
            variant="ghost" size="sm" className="ml-auto"
          >
            Avmarkera
          </Button>
        </div>
      )}

      {confirmDelete !== null && (
        <ConfirmDialog
          title={`Ta bort ${pluralSv(confirmDelete.length, 'titel', 'titlar')}?`}
          body="Titlarna tas bort från ditt bibliotek. Det går inte att ångra."
          confirmLabel="Ta bort"
          busy={deleting}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await Promise.all(confirmDelete.map(item => removeItem(item.mediaType, item.tmdbId)));
              setSelected(new Set());
            } finally {
              setDeleting(false);
              setConfirmDelete(null);
            }
          }}
          onCancel={() => { setDeleting(false); setConfirmDelete(null); }}
        />
      )}

      <div className="mt-4">
        <div>
      {runtimesPending && displayItems.length === 0 ? (
        <LoadingView variant="grid" label="Hämtar speltider…" />
      ) : displayItems.length === 0 && activeFilterCount > 0 ? (
        <FilteredEmptyState noun="titlar" onClearAll={clearAllFilters} />
      ) : view === 'cards' ? (
        followingSections ? (
          <FollowingCardSections
            sections={followingSections}
            nextAirByTmdbId={nextAirByTmdbId}
            selectMode={selectMode}
            isSelected={item => selected.has(keyOf(item))}
            onToggleSelect={item => toggleSelect(keyOf(item))}
          />
        ) : (
          <div className={CARD_GRID_CLASS}>
            {visibleItems.map(item => (
              <WatchlistCard
                key={keyOf(item)}
                item={item}
                nextAirDate={nextAirByTmdbId.get(keyOf(item))}
                selectMode={selectMode}
                selected={selected.has(keyOf(item))}
                onToggleSelect={() => toggleSelect(keyOf(item))}
              />
            ))}
            {hasMore && <div ref={sentinelRef} aria-hidden className="col-span-full h-px" />}
            {displayItems.length === 0 && (
              <div className={cardClass('col-span-full px-3 py-4 text-center text-sm text-ink-3')}>
                {emptyMessage}
              </div>
            )}
          </div>
        )
      ) : view === 'table' ? (
        <>
        <div className={cardClass('overflow-x-auto')}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={thClass('px-2 w-[28px]')}>
                  <input
                    type="checkbox"
                    aria-label="Välj alla"
                    checked={displayItems.length > 0 && selected.size === displayItems.length}
                    onChange={e => {
                      if (e.target.checked) setSelected(new Set(displayItems.map(keyOf)));
                      else setSelected(new Set());
                    }}
                    className="accent-acc-deep w-[13px] h-[13px] cursor-pointer"
                  />
                </th>
                <th className={thClass('text-left px-2 w-[44px]')}></th>
                <th className={thClass('text-left px-2')}>Titel</th>
                {showTypeCol && <th className={thClass('text-left px-2')}>Typ</th>}
                <th className={thClass('text-left px-2')}>År</th>
                {showAddedCol && <th className={thClass('hidden md:table-cell text-left px-2')}>Tillagd</th>}
                {showWatchedCol && <th className={thClass('hidden md:table-cell text-left px-2')}>Sedd</th>}
                <th className={thClass('hidden lg:table-cell text-left px-2')}>Tjänster</th>
                <th className={thClass('text-left px-2')}>Betyg</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item, idx) => {
                const poster = posterUrl(item.posterPath, 'w92');
                const href = titleHref(item.mediaType, item.tmdbId);
                const Icon = item.mediaType === 'tv' ? Tv : Film;
                return (
                  <tr key={keyOf(item)} className={`cursor-pointer hover:[&>td]:bg-bg-2 ${idx % 2 === 1 ? 'bg-bg-2/40' : ''}`}>
                    <td className="px-2 py-1.5 border-b border-border-table" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Välj ${item.title}`}
                        checked={selected.has(keyOf(item))}
                        onChange={() => setSelected(prev => {
                          const next = new Set(prev);
                          const k = keyOf(item);
                          if (next.has(k)) next.delete(k);
                          else next.add(k);
                          return next;
                        })}
                        className="accent-acc-deep w-[13px] h-[13px] cursor-pointer"
                      />
                    </td>
                    <td className="px-2 py-1.5 border-b border-border-table">
                      <Link href={href}>
                        {poster ? (
                          <div className={`poster duo-${toneForId(item.tmdbId)} w-[32px] h-[48px]`}>
                            <img src={poster} alt="" loading="lazy" decoding="async" width={32} height={48} />
                          </div>
                        ) : (
                          <div className="w-[32px] h-[48px] rounded-sm bg-rule-2 flex items-center justify-center">
                            <Icon size={14} className="text-ink-3 opacity-40" />
                          </div>
                        )}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 border-b border-border-table">
                      <Link href={href} className="no-underline text-ink">
                        <div className="font-semibold text-base">
                          {item.title}
                          {item.rewatchCount > 0 && (
                            <span className="ml-1 text-xxs text-ink-3 font-normal">x{item.rewatchCount + 1}</span>
                          )}
                        </div>
                      </Link>
                    </td>
                    {showTypeCol && <td className="px-2 py-1.5 border-b border-border-table text-xs text-ink-3">
                      {item.mediaType === 'movie' ? 'Film' : 'Serie'}
                    </td>}
                    <td className="px-2 py-1.5 border-b border-border-table text-xs text-ink-3">
                      {item.releaseYear ?? '—'}
                    </td>
                    {showAddedCol && <td className="hidden md:table-cell px-2 py-1.5 border-b border-border-table text-xs text-ink-3">
                      {fmtDate(item.addedAt)}
                    </td>}
                    {showWatchedCol && <td className="hidden md:table-cell px-2 py-1.5 border-b border-border-table text-xs text-ink-3">
                      {fmtDate(seenDate(item))}
                    </td>}
                    <td className="hidden lg:table-cell px-2 py-1.5 border-b border-border-table">
                      <ProviderChips providers={item.providers} myProviders={user?.myProviders ?? []} providersCheckedAt={item.providersCheckedAt} />
                    </td>
                    <td className="px-2 py-1.5 border-b border-border-table" onClick={e => e.stopPropagation()}>
                      <span className="inline-flex items-center gap-1">
                        <RatingStars
                          rating={item.rating}
                          onChange={r => updateRating(item.mediaType, item.tmdbId, r)}
                          size="sm"
                          dim={item.rating === null}
                        />
                        {item.rating !== null && (
                          <span className="text-xxs text-ink-3">{formatStars(item.rating)}</span>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {displayItems.length === 0 && (
                <tr>
                  <td colSpan={tableColCount} className="px-3 py-4 text-center text-sm text-ink-3">
                    {emptyMessage}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
        </>
      ) : (
        <div className={cardClass()}>
          <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2.5 md:gap-2 px-3 py-2">
            {visibleItems.map(item => {
              const poster = posterUrl(item.posterPath, 'w342');
              const href = titleHref(item.mediaType, item.tmdbId);
              const Icon = item.mediaType === 'tv' ? Tv : Film;
              const isSel = selected.has(keyOf(item));
              const inner = (
                <>
                  <div className={`poster duo-${toneForId(item.tmdbId)} mb-1 ${selectMode && isSel ? 'outline outline-2 outline-acc-deep' : ''}`}>
                    {poster ? (
                      <img src={poster} srcSet={posterSrcSet(item.posterPath, 'w342')} sizes="(max-width: 767px) 45vw, 140px" alt={item.title} loading="lazy" decoding="async" width={342} height={513} />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center px-2 gap-1">
                        <Icon size={20} className="text-ink-3 opacity-40" />
                        <span className="text-xxs text-ink-3 text-center line-clamp-3 leading-tight">{item.title}</span>
                      </div>
                    )}
                    <PosterProviderDots providers={item.providers} myProviders={user?.myProviders ?? []} />
                    {selectMode && (
                      <span className={`absolute top-1 left-1 z-[1] inline-flex items-center justify-center w-[16px] h-[16px] rounded-sm border ${
                        isSel ? 'bg-acc-deep border-acc-deep text-on-acc' : 'border-rule bg-surface'
                      }`}>
                        {isSel && <Check size={11} />}
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-semibold overflow-hidden text-ellipsis whitespace-nowrap">
                    {item.title}
                  </div>
                  <div className="text-xxs text-ink-3">{item.releaseYear ?? '—'}</div>
                </>
              );
              return selectMode ? (
                <div
                  key={keyOf(item)}
                  role="checkbox"
                  aria-checked={isSel}
                  aria-label={`Välj ${item.title}`}
                  tabIndex={0}
                  onClick={() => toggleSelect(keyOf(item))}
                  className="cursor-pointer text-ink"
                >
                  {inner}
                </div>
              ) : (
                <Link key={keyOf(item)} href={href} className="no-underline text-ink">
                  {inner}
                </Link>
              );
            })}
          </div>
          {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
          {/* B9: prickarna på postrarna är streamingtjänst-indikatorer (en
              färg per tjänst, hover visar namnet) — utan legend lästes de
              som oförklarade statusprickar. */}
          {displayItems.length > 0 && (
            <p className="px-3 pb-2 mt-0 text-xxs text-ink-3">
              Prickar på postern = streamingtjänst (färg per tjänst, hovra för namn). Fylld prick = tjänst du har.
            </p>
          )}
        </div>
      )}
        </div>
      </div>

      {totalCount > 0 && (
        <div style={{ marginTop: 16 }}>
          <JustWatchCredit />
        </div>
      )}
    </>
  );
}

const STATUS_CHOICES: ReadonlyArray<{ value: WatchStatus; label: string }> = [
  { value: 'mina', label: 'Följer' },
  { value: 'vill_se', label: 'Vill se' },
  { value: 'sedd', label: 'Sett' },
  { value: 'avbruten', label: 'Avbrutna' },
];

// B12: biblioteksvyerna (Följer/Vill se/Filmer/Avbrutna/Alla) var onåbara i
// UI:t — Subnav "Bibliotek" pekar bara på /my/all. Den här länkraden gör
// undervyerna nåbara från varje biblioteksvy. Riktiga <Link>:ar (inte
// state-tabbar) så URL:erna förblir delbara; aktiv vy markeras via status-
// propen som mappar 1:1 mot route.
// `key` entries (Dagbok) are route-views without a WatchStatus; they go active
// via the `activeKey` prop instead of status-matching, so they never collide
// with the status tabs (notably 'Alla', whose status is also null).
const LIBRARY_VIEWS: { label: string; href: string; status: WatchStatus | null; key?: string }[] = [
  { label: 'Följer',   href: '/my/series/',   status: 'mina' },
  { label: 'Vill se',  href: '/my/vill-se/',  status: 'vill_se' },
  { label: 'Filmer',   href: '/my/films/',    status: 'sedd' },
  { label: 'Avbrutna', href: '/my/avbrutna/', status: 'avbruten' },
  { label: 'Alla',     href: '/my/all/',      status: null },
  { label: 'Dagbok',   href: '/my/diary/',    status: null, key: 'diary' },
];

// Kompakt dropdown-vy-väljare (variant 2): ersätter den 6-chips-breda flikraden
// med en liten meny. Behåller riktiga <Link>:ar (delbara URL:er) + aktivmarkering.
// Stäng på click-outside + Escape (samma mönster som UgcActionsMenu).
export function LibrarySubnav({ status, activeKey }: { status?: WatchStatus; activeKey?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  // useClickOutside täcker mousedown-utanför; Escape har ingen delad hook — behåll
  // den lilla lyssnaren, gated på open så den inte ligger på globalt.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const isActive = (view: (typeof LIBRARY_VIEWS)[number]) =>
    view.key ? view.key === activeKey : !activeKey && (status ?? null) === view.status;
  // find(isActive) matchar alltid en vy (varje status/activeKey har en rad); render
  // faller ändå tillbaka på 'Alla' om något oväntat inte matchar.
  const activeView = LIBRARY_VIEWS.find(isActive);

  return (
    <div ref={ref} className="relative inline-block mt-3.5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="chip inline-flex items-center gap-1.5"
        aria-expanded={open}
        aria-label="Byt biblioteksvy"
      >
        <Library size={13} className="text-ink-3" />
        <span className="font-semibold">{activeView?.label ?? 'Alla'}</span>
        <ChevronDown size={13} className={`text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <nav
          aria-label="Biblioteksvyer"
          className={cardClass('absolute left-0 top-full mt-1 shadow-pop min-w-[180px] z-30 py-1')}
        >
          {LIBRARY_VIEWS.map(view => {
            const active = isActive(view);
            return (
              <Link
                key={view.href}
                href={view.href}
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className={`flex items-center justify-between gap-3 px-3 py-1.5 text-sm no-underline hover:bg-bg-2 ${active ? 'text-ink font-semibold' : 'text-ink-2'}`}
              >
                {view.label}
                {active && <Check size={13} className="text-acc-deep" />}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}

// Helpers — pure functions for the new header pattern. Pulled out so the
// component body stays focused on view/filter state.

function labelForStatus(status?: WatchStatus): string {
  switch (status) {
    case 'mina':     return 'mina serier';
    case 'sedd':     return 'mina filmer';
    case 'vill_se':  return 'vill se';
    case 'avbruten': return 'avbrutna';
    default:         return 'allt';
  }
}
