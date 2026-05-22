'use client';

import { Suspense, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Search, Film, Tv, X } from 'lucide-react';
import { posterUrl, titleHref } from '@/lib/tmdb/client';
import { getProvider } from '@/lib/tmdb/providers';
import ProviderDot from '@/components/ui/ProviderDot';
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
import { tvSubState } from '@/lib/watchStatus';
import { toneForId } from '@/lib/duotone';
import type { WatchStatus, WatchlistItem, TMDBTVShow } from '@/types';

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
  const { items, removeItem, updateStatus, updateRating } = useWatchlist();
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
  const [view, setView] = useState<ViewMode>(status === 'mina' ? 'cards' : 'grid');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const calendarEntries = useCalendarEntries();
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

  const totalCount = status ? items.filter(i => i.status === status).length : items.length;

  // För /my/series-vyn: dela TV-shows i sub-states (aktiv/ikapp/avslutad)
  // baserat på derived state. Använder advisor-cachen för rik beräkning;
  // shows som inte är i cachen faller tillbaka till tmdbStatus-only-heuristik.
  const showsByTmdbId = useMemo(() => {
    const m = new Map<number, TMDBTVShow>();
    if (!advisor.providers) return m;
    // Vi har inte direkt tillgång till TMDBTVShow-cachen från advisor — gå
    // istället via React Query om vi behöver. För nu räcker fallback i
    // tvSubState (lastWatched + tmdbStatus). Behind-set från advisor täcker
    // 95% av fallen för oss.
    return m;
  }, [advisor.providers]);

  const followingSections = useMemo(() => {
    if (status !== 'mina') return null;
    const tvItems = filtered.filter((i): i is WatchlistItem => i.mediaType === 'tv');
    return bucketBySubState(tvItems, item => {
      // Om showen är i advisor's behind-set vet vi 100% säkert att det är aktiv.
      if (advisor.unfinishedTmdbIds.has(item.tmdbId)) return 'aktiv';
      return tvSubState(item, showsByTmdbId.get(item.tmdbId));
    });
  }, [filtered, status, advisor.unfinishedTmdbIds, showsByTmdbId]);

  const standfirst = buildStandfirst(filtered.length, totalCount, status, mediaFilter);

  return (
    <>
      <header>
        <div className="crumb">
          Bibliotek · {labelForStatus(status)}{providerFilter ? ` · ${providerFilter.shortName}` : ''}{behindFilterActive ? ' · efter' : ''}
        </div>
        <h1 className="page-h1">{title}</h1>
        <p className="stand">{standfirst}</p>
      </header>

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
          {behindFilterActive && <span>ligger efter</span>}
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

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 22, flexWrap: 'wrap' }}>
        {status !== 'mina' && (
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

        {status !== 'mina' && (
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
            <option value="watchedAt">Sedd datum</option>
          </select>
        )}

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
          <span className="text-xs text-text-secondary">{selected.size} markerade</span>
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
            {filtered.map(item => (
              <WatchlistCard
                key={item.tmdbId}
                item={item}
                nextAirDate={nextAirByTmdbId.get(item.tmdbId)}
              />
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full bg-surface border border-border-main rounded-sm px-3 py-4 text-center text-sm text-text-muted">
                Inga titlar att visa
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
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={e => {
                      if (e.target.checked) setSelected(new Set(filtered.map(i => i.tmdbId)));
                      else setSelected(new Set());
                    }}
                    className="accent-accent w-[13px] h-[13px] cursor-pointer"
                  />
                </th>
                <th className="text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header w-[44px]"></th>
                <th className="text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Titel</th>
                <th className="text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Typ</th>
                <th className="text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">År</th>
                {showAddedCol && <th className="hidden md:table-cell text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Tillagd</th>}
                {showWatchedCol && <th className="hidden md:table-cell text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Sedd</th>}
                <th className="hidden lg:table-cell text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Tjänster</th>
                <th className="text-left px-2 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Betyg</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => {
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
                    <td className="px-2 py-[5px] border-b border-border-table text-xs text-text-muted">
                      {item.mediaType === 'movie' ? 'Film' : 'Serie'}
                    </td>
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
                        />
                        {item.rating !== null && (
                          <span className="text-xxs text-text-muted">{item.rating.toFixed(1)}</span>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-center text-sm text-text-muted">
                    Inga titlar att visa
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-surface border border-border-main rounded-sm">
          <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-[10px] md:gap-[7px] px-3 py-2">
            {filtered.map(item => {
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
        </div>
      )}
    </>
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

function buildStandfirst(
  visible: number,
  total: number,
  status: WatchStatus | undefined,
  mediaFilter: 'all' | 'tv' | 'movie',
): string {
  const noun = mediaFilter === 'tv' ? 'serier' : mediaFilter === 'movie' ? 'filmer' : 'titlar';
  if (total === 0) {
    return 'Inget i biblioteket än. Hitta något att titta på via Rekommendationer.';
  }
  if (visible === 0) {
    return `Inga ${noun} matchar dina filter. Justera ovan eller rensa.`;
  }
  if (visible === total) {
    return `${visible} ${noun} i ${status ? 'denna lista' : 'biblioteket'}. Vi räknade åt dig.`;
  }
  return `${visible} av ${total} ${noun} visas. Filtrera mer eller justera vyn.`;
}
