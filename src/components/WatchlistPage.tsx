'use client';

import { Suspense, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Search, Film, Tv, X } from 'lucide-react';
import { posterUrl, titleHref } from '@/lib/tmdb/client';
import { getProvider } from '@/lib/tmdb/providers';
import ProviderDot from '@/components/ui/ProviderDot';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { LoadingView } from '@/components/ui/LoadingView';
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
  LIBRARY_SUB_STATE_ORDER,
} from '@/lib/libraryView';
import { pluralSv } from '@/lib/utils';
import { toneForId } from '@/lib/duotone';
import type { WatchStatus, WatchlistItem } from '@/types';

type SortKey = 'updatedAt' | 'addedAt' | 'watchedAt' | 'title' | 'rating' | 'releaseYear';

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
}
type ViewMode = 'table' | 'grid' | 'cards';
type MediaFilter = 'all' | 'movie' | 'tv';

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
  const { items, loading: watchlistLoading, removeItem, updateStatus, updateRating } = useWatchlist();
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
  const advisor = useSubscriptionAdvisor();
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
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const { entries: calendarEntries } = useCalendarEntries();
  const nextAirByTmdbId = useMemo(() => {
    const m = new Map<number, string>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const e of calendarEntries) {
      if (new Date(e.airDate) < today) continue;
      const prev = m.get(e.tmdbId);
      if (!prev || e.airDate < prev) m.set(e.tmdbId, e.airDate);
    }
    return m;
  }, [calendarEntries]);

  useEffect(() => {
    // B15 (works-as-designed): /my/series öppnar alltid i Kort-vyn oavsett
    // användarens defaultView-inställning. Kort är den enda vyn med
    // sub-state-sektionsrubriker (Ligger efter/Pågående/…) — det är vyn som
    // gör Följer-listan aktionerbar. Tabell/Rutnät får samma gruppordning
    // (se displayItems) men utan rubriker. Medvetet undantag — ska inte
    // flaggas som bugg i framtida audits.
    if (status === 'mina') return;
    if (user?.defaultView) setView(user.defaultView);
  }, [user?.defaultView, status]);

  const filtered = useMemo(() => {
    let result = status ? items.filter(i => i.status === status && (status !== 'mina' || !i.dropped)) : items;
    if (mediaFilter !== 'all') {
      result = result.filter(i => i.mediaType === mediaFilter);
    }
    if (providerFilterId != null) {
      result = result.filter(i => i.providers.includes(providerFilterId));
    }
    if (behindIds) {
      result = result.filter(i => behindIds.has(i.tmdbId));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i => i.title.toLowerCase().includes(q));
    }
    result = [...result].sort((a, b) => {
      switch (sort) {
        case 'title': return a.title.localeCompare(b.title, 'sv');
        case 'rating': return (b.rating ?? 0) - (a.rating ?? 0);
        case 'releaseYear': return (b.releaseYear ?? 0) - (a.releaseYear ?? 0);
        case 'addedAt': return b.addedAt.getTime() - a.addedAt.getTime();
        case 'watchedAt': return (b.watchedAt?.getTime() ?? 0) - (a.watchedAt?.getTime() ?? 0);
        default: return b.updatedAt.getTime() - a.updatedAt.getTime();
      }
    });
    return result;
  }, [items, status, mediaFilter, sort, searchQuery, providerFilterId, behindIds]);

  const totalCount = status
    ? items.filter(i => i.status === status && (status !== 'mina' || !i.dropped)).length
    : items.length;

  // B7/T2: substate för /my/series härleds från PERSISTERADE fält enbart
  // (kontraktet bor i src/lib/libraryView.ts) + advisorns behind-set som
  // "vet säkert bakom"-signal. Behind-settet bygger på TMDB-data som
  // useSubscriptionAdvisor/useCalendarEntries redan hämtat för andra syften
  // på den här sidan — INGEN extra TMDB-fan-out introduceras för substate.
  const subStateOf = useMemo(() => {
    const behind = advisor.unfinishedTmdbIds;
    return (item: WatchlistItem) => librarySubState(item, behind.has(item.tmdbId));
  }, [advisor.unfinishedTmdbIds]);

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

  const followingSections = useMemo(() => {
    if (status !== 'mina') return null;
    const tvItems = displayItems.filter((i): i is WatchlistItem => i.mediaType === 'tv');
    return bucketBySubState(tvItems, subStateOf);
  }, [displayItems, status, subStateOf]);

  // På /my/series (status==='mina') renderas endast TV-titlar i sektionerna
  // (followingSections filtrerar bort movie-items). Räkna samma mängd i
  // standfirst så subtitle inte säger mer än sektionerna visar — och räkna
  // total mot samma TV-delmängd så "X av Y" stämmer vid sökning (B1/B5).
  const tvVisibleCount = filtered.filter(i => i.mediaType === 'tv').length;
  const tvTotalCount = items.filter(
    i => i.status === 'mina' && !i.dropped && i.mediaType === 'tv'
  ).length;
  const standfirst = status === 'mina'
    ? buildStandfirst(tvVisibleCount, tvTotalCount, status, mediaFilter)
    : buildStandfirst(filtered.length, totalCount, status, mediaFilter);

  const hasActiveFilters =
    mediaFilter !== 'all' ||
    !!providerFilter ||
    behindFilterActive ||
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
  // bygger på TV-detaljqueries. Gatear vi inte på advisor.isLoading (äkta
  // settled-flagga sedan 9f5b731) grupperas korten på partiell data och
  // migrerar synligt mellan sektioner allteftersom queries löser. Samma
  // mönster som R1: rendera en gång på komplett data. Gäller BARA 'mina' —
  // övriga biblioteksvyer använder inte advisor-datat och ska inte blockeras.
  if (watchlistLoading || (status === 'mina' && advisor.isLoading)) {
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
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: 0.12, textTransform: 'uppercase' }}>
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
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'tv', 'movie'] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => { setMediaFilter(f); setSelected(new Set()); }}
                className={`chip${mediaFilter === f ? ' is-on' : ''}`}
              >
                {f === 'all' ? 'Alla' : f === 'tv' ? 'Serier' : 'Film'}
              </button>
            ))}
          </div>
        )}

        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortKey)}
          style={{
            fontFamily: 'var(--mono)', fontSize: 12,
            border: '1px solid var(--rule)', borderRadius: 6,
            padding: '5px 10px',
            background: 'var(--surface)', color: 'var(--ink-2)',
            outline: 'none', cursor: 'pointer',
            letterSpacing: 0.04,
          }}
        >
          <option value="updatedAt">Senast ändrad</option>
          <option value="title">Titel A-Ö</option>
          <option value="rating">Betyg</option>
          <option value="releaseYear">År</option>
          <option value="addedAt">Tillagd</option>
          {/* TV i 'mina' har aldrig watchedAt (film-only terminal) — dölj no-op-sorteringen där. */}
          {status !== 'mina' && <option value="watchedAt">Sedd datum</option>}
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
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              style={{
                background: 'transparent', border: 0,
                fontFamily: 'var(--mono)', fontSize: 11.5,
                color: 'var(--ink)', outline: 'none', width: 140,
              }}
            />
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {(['table', 'cards', 'grid'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`chip${view === v ? ' is-on' : ''}`}
            >
              {v === 'table' ? 'Tabell' : v === 'cards' ? 'Kort' : 'Rutnät'}
            </button>
          ))}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-2 px-2 py-[5px] bg-accent/10 border border-accent/20 rounded-sm">
          <span className="text-xs text-text-secondary">{pluralSv(selected.size, 'markerad', 'markerade')}</span>
          {(status === 'mina' || status === 'vill_se') && (
            <button
              onClick={async () => {
                // För vill_se: flytta till mina (om TV) eller sedd (film) per item.
                // För mina (TV): kommer rendera 0 items här eftersom 'mina' bara
                // gäller TV och TV inte kan flyttas till 'sedd' längre — den
                // klickas via bulk-radera istället. Lämnar knappen kvar för
                // legacy-vill_se-blandade item.
                await Promise.all(Array.from(selected).map(id => {
                  const item = items.find(i => i.tmdbId === id);
                  const target: 'mina' | 'sedd' = item?.mediaType === 'tv' ? 'mina' : 'sedd';
                  return updateStatus(id, target);
                }));
                setSelected(new Set());
              }}
              className="px-2 py-[2px] text-xs border-none rounded-sm cursor-pointer bg-accent text-white font-[inherit]"
            >
              Markera som tittad
            </button>
          )}
          {status === 'sedd' && (
            <button
              onClick={async () => {
                await Promise.all(Array.from(selected).map(id => updateStatus(id, 'vill_se')));
                setSelected(new Set());
              }}
              className="px-2 py-[2px] text-xs border-none rounded-sm cursor-pointer bg-accent text-white font-[inherit]"
            >
              Flytta till Vill se
            </button>
          )}
          <button
            onClick={async () => {
              await Promise.all(Array.from(selected).map(id => removeItem(id)));
              setSelected(new Set());
            }}
            className="px-2 py-[2px] text-xs border border-red-300 rounded-sm cursor-pointer bg-surface text-red-600 font-[inherit]"
          >
            Ta bort
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="px-2 py-[2px] text-xs border border-border-main rounded-sm cursor-pointer bg-surface text-text-muted font-[inherit] ml-auto"
          >
            Avmarkera
          </button>
        </div>
      )}

      {view === 'cards' ? (
        followingSections ? (
          <FollowingCardSections
            sections={followingSections}
            nextAirByTmdbId={nextAirByTmdbId}
          />
        ) : (
          <div className={CARD_GRID_CLASS}>
            {displayItems.map(item => (
              <WatchlistCard
                key={item.tmdbId}
                item={item}
                nextAirDate={nextAirByTmdbId.get(item.tmdbId)}
              />
            ))}
            {displayItems.length === 0 && (
              <div className="col-span-full bg-surface border border-border-main rounded-sm px-3 py-4 text-center text-sm text-text-muted">
                {emptyMessage}
              </div>
            )}
          </div>
        )
      ) : view === 'table' ? (
        <div className="bg-surface border border-border-main rounded-sm overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="px-2 py-[6px] border-b border-border-light bg-cal-header w-[28px]">
                  <input
                    type="checkbox"
                    checked={displayItems.length > 0 && selected.size === displayItems.length}
                    onChange={e => {
                      if (e.target.checked) setSelected(new Set(displayItems.map(i => i.tmdbId)));
                      else setSelected(new Set());
                    }}
                    className="accent-accent w-[13px] h-[13px] cursor-pointer"
                  />
                </th>
                <th className="text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header w-[44px]"></th>
                <th className="text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Titel</th>
                {showTypeCol && <th className="text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Typ</th>}
                <th className="text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">År</th>
                {showAddedCol && <th className="hidden md:table-cell text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Tillagd</th>}
                {showWatchedCol && <th className="hidden md:table-cell text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Sedd</th>}
                <th className="hidden lg:table-cell text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Tjänster</th>
                <th className="text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Betyg</th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item, idx) => {
                const poster = posterUrl(item.posterPath, 'w92');
                const href = titleHref(item.mediaType, item.tmdbId);
                const Icon = item.mediaType === 'tv' ? Tv : Film;
                return (
                  <tr key={item.tmdbId} className={`cursor-pointer hover:[&>td]:bg-surface-hover ${idx % 2 === 1 ? 'bg-surface-hover/40' : ''}`}>
                    <td className="px-2 py-[5px] border-b border-border-table" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(item.tmdbId)}
                        onChange={() => setSelected(prev => {
                          const next = new Set(prev);
                          if (next.has(item.tmdbId)) next.delete(item.tmdbId);
                          else next.add(item.tmdbId);
                          return next;
                        })}
                        className="accent-accent w-[13px] h-[13px] cursor-pointer"
                      />
                    </td>
                    <td className="px-2 py-[5px] border-b border-border-table">
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
                    <td className="px-2 py-[5px] border-b border-border-table">
                      <Link href={href} className="no-underline text-text-primary">
                        <div className="font-semibold text-base">
                          {item.title}
                          {item.rewatchCount > 0 && (
                            <span className="ml-1 text-xxs text-text-muted font-normal">x{item.rewatchCount + 1}</span>
                          )}
                        </div>
                      </Link>
                    </td>
                    {showTypeCol && <td className="px-2 py-[5px] border-b border-border-table text-xs text-text-muted">
                      {item.mediaType === 'movie' ? 'Film' : 'Serie'}
                    </td>}
                    <td className="px-2 py-[5px] border-b border-border-table text-xs text-text-muted">
                      {item.releaseYear ?? '—'}
                    </td>
                    {showAddedCol && <td className="hidden md:table-cell px-2 py-[5px] border-b border-border-table text-xs text-text-muted">
                      {fmtDate(item.addedAt)}
                    </td>}
                    {showWatchedCol && <td className="hidden md:table-cell px-2 py-[5px] border-b border-border-table text-xs text-text-muted">
                      {fmtDate(item.watchedAt)}
                    </td>}
                    <td className="hidden lg:table-cell px-2 py-[5px] border-b border-border-table">
                      <ProviderChips providers={item.providers} myProviders={user?.myProviders ?? []} providersCheckedAt={item.providersCheckedAt} />
                    </td>
                    <td className="px-2 py-[5px] border-b border-border-table" onClick={e => e.stopPropagation()}>
                      <span className="inline-flex items-center gap-[4px]">
                        <RatingStars
                          rating={item.rating}
                          onChange={r => updateRating(item.tmdbId, r)}
                          size="sm"
                          dim={item.rating === null}
                        />
                        {item.rating !== null && (
                          <span className="text-xxs text-text-muted">{item.rating.toFixed(1)}</span>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {displayItems.length === 0 && (
                <tr>
                  <td colSpan={tableColCount} className="px-3 py-4 text-center text-sm text-text-muted">
                    {emptyMessage}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-surface border border-border-main rounded-sm">
          <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-[10px] md:gap-[7px] px-3 py-2">
            {displayItems.map(item => {
              const poster = posterUrl(item.posterPath, 'w342');
              const href = titleHref(item.mediaType, item.tmdbId);
              const Icon = item.mediaType === 'tv' ? Tv : Film;
              return (
                <Link key={item.tmdbId} href={href} className="no-underline text-text-primary">
                  <div className={`poster duo-${toneForId(item.tmdbId)} mb-[3px]`}>
                    {poster ? (
                      <img src={poster} alt={item.title} loading="lazy" decoding="async" width={342} height={513} />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center px-2 gap-1">
                        <Icon size={20} className="text-ink-3 opacity-40" />
                        <span className="text-[10px] text-ink-3 text-center line-clamp-3 leading-tight">{item.title}</span>
                      </div>
                    )}
                    <PosterProviderDots providers={item.providers} myProviders={user?.myProviders ?? []} />
                  </div>
                  <div className="text-xs font-semibold overflow-hidden text-ellipsis whitespace-nowrap">
                    {item.title}
                  </div>
                  <div className="text-xxs text-text-muted">{item.releaseYear ?? '—'}</div>
                </Link>
              );
            })}
          </div>
          {/* B9: prickarna på postrarna är streamingtjänst-indikatorer (en
              färg per tjänst, hover visar namnet) — utan legend lästes de
              som oförklarade statusprickar. */}
          {displayItems.length > 0 && (
            <p className="px-3 pb-2 mt-0 text-xxs text-text-muted">
              Prickar på postern = streamingtjänst (färg per tjänst, hovra för namn). Fylld prick = tjänst du har.
            </p>
          )}
        </div>
      )}

      {totalCount > 0 && (
        <div style={{ marginTop: 16 }}>
          <JustWatchCredit />
        </div>
      )}
    </>
  );
}

// B12: biblioteksvyerna (Följer/Vill se/Filmer/Avbrutna/Alla) var onåbara i
// UI:t — Subnav "Bibliotek" pekar bara på /my/all. Den här länkraden gör
// undervyerna nåbara från varje biblioteksvy. Riktiga <Link>:ar (inte
// state-tabbar) så URL:erna förblir delbara; aktiv vy markeras via status-
// propen som mappar 1:1 mot route.
const LIBRARY_VIEWS: { label: string; href: string; status: WatchStatus | null }[] = [
  { label: 'Följer',   href: '/my/series/',   status: 'mina' },
  { label: 'Vill se',  href: '/my/vill-se/',  status: 'vill_se' },
  { label: 'Filmer',   href: '/my/films/',    status: 'sedd' },
  { label: 'Avbrutna', href: '/my/avbrutna/', status: 'avbruten' },
  { label: 'Alla',     href: '/my/all/',      status: null },
];

function LibrarySubnav({ status }: { status?: WatchStatus }) {
  return (
    <nav aria-label="Biblioteksvyer" style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
      {LIBRARY_VIEWS.map(view => {
        const active = (status ?? null) === view.status;
        return (
          <Link
            key={view.href}
            href={view.href}
            aria-current={active ? 'page' : undefined}
            className={`chip no-underline${active ? ' is-on' : ''}`}
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
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
