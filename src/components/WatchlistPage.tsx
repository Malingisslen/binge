'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Search, Film, Tv } from 'lucide-react';
import { posterUrl } from '@/lib/tmdb/client';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { useCalendarEntries } from '@/hooks/useCalendar';
import { getProvider } from '@/lib/tmdb/providers';
import RatingStars from '@/components/title/RatingStars';
import { shortSwedishWeekday, daysBetween, todayIso } from '@/lib/utils';
import { isEndedStatus } from '@/lib/airingState';
import type { WatchStatus, WatchlistItem } from '@/types';

function upcomingWeekday(isoDate: string | undefined): string | null {
  if (!isoDate) return null;
  if (isoDate < todayIso()) return null;
  if (daysBetween(todayIso(), new Date(isoDate + 'T00:00:00')) > 4) return null;
  return shortSwedishWeekday(isoDate);
}

type SortKey = 'updatedAt' | 'addedAt' | 'watchedAt' | 'title' | 'rating' | 'releaseYear';

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
}
type ViewMode = 'table' | 'grid' | 'cards';
type MediaFilter = 'all' | 'movie' | 'tv';

const CARD_GRID_CLASS = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[10px]';

interface WatchlistPageProps {
  status?: WatchStatus;
  title: string;
}

export default function WatchlistPage({ status, title }: WatchlistPageProps) {
  const { items, removeItem, updateStatus, updateRating } = useWatchlist();
  const { user } = useAuth();
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [sort, setSort] = useState<SortKey>('updatedAt');
  const showAddedCol = status !== 'sedd';
  const showWatchedCol = status === 'sedd' || !status;
  const [view, setView] = useState<ViewMode>(status === 'följer' ? 'cards' : 'grid');
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
    if (status === 'följer') return;
    if (user?.defaultView) setView(user.defaultView);
  }, [user?.defaultView, status]);

  const filtered = useMemo(() => {
    let result = status ? items.filter(i => i.status === status && (status !== 'följer' || !i.dropped)) : items;
    if (mediaFilter !== 'all') {
      result = result.filter(i => i.mediaType === mediaFilter);
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
  }, [items, status, mediaFilter, sort, searchQuery]);

  const totalCount = status ? items.filter(i => i.status === status).length : items.length;

  const followingSections = useMemo(() => {
    if (status !== 'följer') return null;
    const ongoing: WatchlistItem[] = [];
    const ended: WatchlistItem[] = [];
    for (const item of filtered) {
      if (item.mediaType === 'tv' && isEndedStatus(item.tmdbStatus)) ended.push(item);
      else ongoing.push(item);
    }
    return { ongoing, ended };
  }, [filtered, status]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-[18px] font-bold text-text-primary">{title}</h1>
        <span className="text-xs text-text-muted">{filtered.length} {filtered.length === 1 ? 'titel' : 'titlar'}</span>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {status !== 'följer' && (
          <div className="flex gap-[1px]">
            {(['all', 'tv', 'movie'] as const).map(f => (
              <span
                key={f}
                onClick={() => { setMediaFilter(f); setSelected(new Set()); }}
                className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
                  mediaFilter === f ? 'bg-accent text-white' : 'text-text-muted'
                }`}
              >
                {f === 'all' ? 'Alla' : f === 'tv' ? 'Serier' : 'Film'}
              </span>
            ))}
          </div>
        )}

        {status !== 'följer' && (
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="text-xs border border-border-main rounded-sm px-2 py-[2px] bg-surface text-text-secondary font-[inherit] outline-none"
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
          <div className="flex items-center gap-[5px] px-2 py-[2px] bg-surface border border-border-main rounded-sm">
            <Search size={11} className="text-text-muted shrink-0" />
            <input
              type="text"
              placeholder="Sök titel..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="bg-transparent border-none text-xs text-text-primary font-[inherit] outline-none w-[100px] placeholder:text-text-muted"
            />
          </div>
        )}

        <div className="flex gap-[1px] ml-auto">
          <span
            onClick={() => setView('table')}
            className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
              view === 'table' ? 'bg-accent text-white' : 'text-text-muted'
            }`}
          >
            Tabell
          </span>
          <span
            onClick={() => setView('cards')}
            className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
              view === 'cards' ? 'bg-accent text-white' : 'text-text-muted'
            }`}
          >
            Kort
          </span>
          <span
            onClick={() => setView('grid')}
            className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
              view === 'grid' ? 'bg-accent text-white' : 'text-text-muted'
            }`}
          >
            Rutnät
          </span>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-2 px-2 py-[5px] bg-accent/10 border border-accent/20 rounded-sm">
          <span className="text-xs text-text-secondary">{selected.size} markerade</span>
          {(status === 'följer' || status === 'vill_se') && (
            <button
              onClick={async () => {
                await Promise.all(Array.from(selected).map(id => updateStatus(id, 'sedd')));
                setSelected(new Set());
              }}
              className="px-2 py-[2px] text-xs border-none rounded-sm cursor-pointer bg-accent text-white font-[inherit]"
            >
              Markera sedd
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
                const href = item.mediaType === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;
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
                          <img src={poster} alt="" className="w-[32px] h-[48px] rounded-sm object-cover" />
                        ) : (
                          <div className="w-[32px] h-[48px] rounded-sm bg-[#ddd8d0] flex items-center justify-center">
                            <Icon size={14} className="text-text-muted opacity-40" />
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
                      <ProviderChips providers={item.providers} myProviders={user?.myProviders ?? []} />
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
              const href = item.mediaType === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;
              const Icon = item.mediaType === 'tv' ? Tv : Film;
              return (
                <Link key={item.tmdbId} href={href} className="no-underline text-text-primary">
                  <div className="aspect-[2/3] bg-[#ddd8d0] rounded-sm mb-[3px] relative overflow-hidden">
                    {poster ? (
                      <img src={poster} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center px-2 gap-1">
                        <Icon size={20} className="text-text-muted opacity-40" />
                        <span className="text-[10px] text-text-muted text-center line-clamp-3 leading-tight">{item.title}</span>
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
    </div>
  );
}

function ProviderChips({ providers, myProviders }: { providers: number[]; myProviders: number[] }) {
  const items = providers.slice(0, 3);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-[2px]">
      {items.map(id => {
        const p = getProvider(id);
        if (!p) return null;
        const isMine = myProviders.includes(id);
        return (
          <span
            key={id}
            className={`text-xxs px-1 py-[1px] border rounded-sm inline-block ${
              isMine ? 'border-accent text-accent' : 'border-border-main text-text-muted'
            }`}
          >
            {p.shortName}
          </span>
        );
      })}
    </div>
  );
}

function PosterProviderDots({ providers, myProviders }: { providers: number[]; myProviders: number[] }) {
  const items = providers.slice(0, 3);
  if (items.length === 0) return null;
  return (
    <div className="absolute top-1 right-1 flex flex-col gap-[3px]">
      {items.map(id => {
        const p = getProvider(id);
        if (!p) return null;
        const isMine = myProviders.includes(id);
        return (
          <span
            key={id}
            title={p.name}
            className={`block w-[7px] h-[7px] rounded-full ${isMine ? '' : 'opacity-50'}`}
            style={{ backgroundColor: p.color, outline: '1.5px solid rgba(0,0,0,0.35)' }}
          />
        );
      })}
    </div>
  );
}

function FollowingCardSections({
  sections,
  nextAirByTmdbId,
}: {
  sections: { ongoing: WatchlistItem[]; ended: WatchlistItem[] };
  nextAirByTmdbId: Map<number, string>;
}) {
  const [endedOpen, setEndedOpen] = useState(false);
  const { ongoing, ended } = sections;
  const totalEmpty = ongoing.length === 0 && ended.length === 0;

  if (totalEmpty) {
    return (
      <div className="bg-surface border border-border-main rounded-sm px-3 py-4 text-center text-sm text-text-muted">
        Inga titlar att visa
      </div>
    );
  }

  return (
    <div className="space-y-[14px]">
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold">
            Pågår
          </h2>
          <span className="text-xxs text-text-muted">
            {ongoing.length} {ongoing.length === 1 ? 'titel' : 'titlar'}
          </span>
        </div>
        {ongoing.length > 0 ? (
          <div className={CARD_GRID_CLASS}>
            {ongoing.map(item => (
              <WatchlistCard
                key={item.tmdbId}
                item={item}
                nextAirDate={nextAirByTmdbId.get(item.tmdbId)}
              />
            ))}
          </div>
        ) : (
          <div className="bg-surface border border-border-main rounded-sm px-3 py-3 text-center text-xs text-text-muted">
            Inga pågående titlar just nu.
          </div>
        )}
      </section>

      {ended.length > 0 && (
        <section>
          <button
            onClick={() => setEndedOpen(!endedOpen)}
            className="w-full flex items-center justify-between mb-2 bg-transparent border-none p-0 cursor-pointer text-left"
          >
            <h2 className="text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold flex items-center gap-1">
              Avslutade / pågående titt
              <span className="text-[9px] text-text-muted/70">
                {endedOpen ? '▾' : '▸'}
              </span>
            </h2>
            <span className="text-xxs text-text-muted">
              {ended.length} {ended.length === 1 ? 'titel' : 'titlar'}
            </span>
          </button>
          {endedOpen && (
            <div className={CARD_GRID_CLASS}>
              {ended.map(item => (
                <WatchlistCard
                  key={item.tmdbId}
                  item={item}
                  nextAirDate={nextAirByTmdbId.get(item.tmdbId)}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function WatchlistCard({ item, nextAirDate }: { item: WatchlistItem; nextAirDate?: string }) {
  const { user } = useAuth();
  const myProviders = user?.myProviders ?? [];
  const poster = posterUrl(item.posterPath, 'w185');
  const href = item.mediaType === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;
  const Icon = item.mediaType === 'tv' ? Tv : Film;

  const progressPct = useMemo(() => {
    if (item.mediaType !== 'tv') return null;
    if (item.status === 'sedd') return 100;
    if (!item.totalSeasons || !item.lastWatchedSeason) return 0;
    const seasonPart = (item.lastWatchedSeason - 1) / item.totalSeasons;
    const episodePart = item.lastWatchedEpisode ? 1 / (item.totalSeasons * 20) : 0;
    return Math.min(100, Math.round((seasonPart + episodePart) * 100));
  }, [item]);

  const upcomingWd = upcomingWeekday(nextAirDate);
  const progressLabel: { text: string; tone: 'done' | 'accent' | 'muted' } = (() => {
    if (item.mediaType === 'movie') {
      return { text: item.status === 'sedd' ? 'Sedd' : '—', tone: item.status === 'sedd' ? 'done' : 'muted' };
    }
    if (item.status === 'sedd') return { text: 'Klar', tone: 'done' };
    if (upcomingWd) return { text: `Nytt ${upcomingWd.toLowerCase()}`, tone: 'accent' };
    if (!item.totalSeasons) return { text: '—', tone: 'muted' };
    if (item.lastWatchedSeason) return { text: `Pågår S${item.lastWatchedSeason}`, tone: 'muted' };
    return { text: 'Ej påbörjad', tone: 'muted' };
  })();

  const providersToShow = item.providers.slice(0, 3);

  return (
    <div className="bg-surface border border-border-main rounded-sm p-[10px] flex gap-[10px] hover:border-accent/40 transition-colors">
      <Link href={href} className="shrink-0">
        {poster ? (
          <img src={poster} alt="" className="w-[50px] h-[75px] rounded-sm object-cover" loading="lazy" />
        ) : (
          <div className="w-[50px] h-[75px] rounded-sm bg-[#ddd8d0] flex items-center justify-center">
            <Icon size={16} className="text-text-muted opacity-40" />
          </div>
        )}
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <Link href={href} className="no-underline text-text-primary min-w-0">
            <div className="text-xs font-semibold truncate">{item.title}</div>
          </Link>
          <span className="shrink-0">
            {item.rating !== null ? (
              <span className="inline-flex items-center gap-[3px]">
                <RatingStars rating={item.rating} readonly size="sm" />
                <span className="text-xxs text-text-muted">{item.rating.toFixed(1)}</span>
              </span>
            ) : (
              <span className="text-xxs text-text-muted/60">Ej betygsatt</span>
            )}
          </span>
        </div>
        <div className="text-xxs text-text-muted mt-[1px]">
          {item.releaseYear ?? '—'}
          {item.mediaType === 'tv' && item.totalSeasons ? ` · ${item.totalSeasons} säsong${item.totalSeasons === 1 ? '' : 'er'}` : ''}
        </div>
        {providersToShow.length > 0 && (
          <div className="mt-[4px] flex flex-wrap gap-[2px]">
            {providersToShow.map(id => {
              const p = getProvider(id);
              if (!p) return null;
              const isMine = myProviders.includes(id);
              return (
                <span
                  key={id}
                  className={`text-xxs px-1 py-[1px] border rounded-sm inline-block ${
                    isMine ? 'border-accent text-accent' : 'border-border-main text-text-muted'
                  }`}
                >
                  {p.shortName}
                </span>
              );
            })}
          </div>
        )}
        {item.mediaType === 'tv' && (
          <div className="mt-[5px] flex items-center gap-[6px]">
            <div className="flex-1 h-[3px] bg-[#eee] rounded-sm overflow-hidden">
              <div
                className={`h-full ${progressLabel.tone === 'done' ? 'bg-[#2e7d32]' : 'bg-accent'}`}
                style={{ width: `${progressPct ?? 0}%` }}
              />
            </div>
            <span className={`text-xxs ${
              progressLabel.tone === 'done' ? 'text-[#2e7d32]'
              : progressLabel.tone === 'accent' ? 'text-accent font-semibold'
              : 'text-text-muted'
            }`}>
              {progressLabel.text}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
