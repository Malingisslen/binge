'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { posterUrl } from '@/lib/tmdb/client';
import { useWatchlist } from '@/hooks/useWatchlist';
import type { WatchStatus } from '@/types';

type SortKey = 'updatedAt' | 'title' | 'rating' | 'releaseYear';
type ViewMode = 'table' | 'grid';
type MediaFilter = 'all' | 'movie' | 'tv';

interface WatchlistPageProps {
  status?: WatchStatus;
  title: string;
}

export default function WatchlistPage({ status, title }: WatchlistPageProps) {
  const { items } = useWatchlist();
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [sort, setSort] = useState<SortKey>('updatedAt');
  const [view, setView] = useState<ViewMode>('table');

  const filtered = useMemo(() => {
    let result = status ? items.filter(i => i.status === status && (status !== 'följer' || !i.dropped)) : items;
    if (mediaFilter !== 'all') {
      result = result.filter(i => i.mediaType === mediaFilter);
    }
    result = [...result].sort((a, b) => {
      switch (sort) {
        case 'title': return a.title.localeCompare(b.title, 'sv');
        case 'rating': return (b.rating ?? 0) - (a.rating ?? 0);
        case 'releaseYear': return (b.releaseYear ?? 0) - (a.releaseYear ?? 0);
        default: return b.updatedAt.getTime() - a.updatedAt.getTime();
      }
    });
    return result;
  }, [items, status, mediaFilter, sort]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-md font-bold text-text-primary">{title}</h1>
        <span className="text-xs text-text-muted">{filtered.length} titlar</span>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex gap-[1px]">
          {(['all', 'tv', 'movie'] as const).map(f => (
            <span
              key={f}
              onClick={() => setMediaFilter(f)}
              className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
                mediaFilter === f ? 'bg-accent text-white' : 'text-text-muted'
              }`}
            >
              {f === 'all' ? 'Alla' : f === 'tv' ? 'Serier' : 'Film'}
            </span>
          ))}
        </div>

        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortKey)}
          className="text-xs border border-border-main rounded-sm px-2 py-[2px] bg-surface text-text-secondary font-[inherit] outline-none"
        >
          <option value="updatedAt">Senast ändrad</option>
          <option value="title">Titel A-Ö</option>
          <option value="rating">Betyg</option>
          <option value="releaseYear">År</option>
        </select>

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
            onClick={() => setView('grid')}
            className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
              view === 'grid' ? 'bg-accent text-white' : 'text-text-muted'
            }`}
          >
            Rutnät
          </span>
        </div>
      </div>

      {view === 'table' ? (
        <div className="bg-surface border border-border-main rounded-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left px-2 py-1 text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header w-[36px]"></th>
                <th className="text-left px-2 py-1 text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Titel</th>
                <th className="text-left px-2 py-1 text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Typ</th>
                <th className="text-left px-2 py-1 text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">År</th>
                <th className="text-left px-2 py-1 text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Betyg</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const poster = posterUrl(item.posterPath, 'w92');
                const href = item.mediaType === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;
                return (
                  <tr key={item.tmdbId} className="cursor-pointer hover:[&>td]:bg-surface-hover">
                    <td className="px-2 py-[5px] border-b border-border-table">
                      <Link href={href}>
                        {poster ? (
                          <img src={poster} alt="" className="w-[26px] h-[39px] rounded-sm object-cover" />
                        ) : (
                          <div className="w-[26px] h-[39px] rounded-sm bg-[#ddd8d0]" />
                        )}
                      </Link>
                    </td>
                    <td className="px-2 py-[5px] border-b border-border-table">
                      <Link href={href} className="no-underline text-text-primary">
                        <div className="font-semibold text-base">{item.title}</div>
                      </Link>
                    </td>
                    <td className="px-2 py-[5px] border-b border-border-table text-xs text-text-muted">
                      {item.mediaType === 'movie' ? 'Film' : 'Serie'}
                    </td>
                    <td className="px-2 py-[5px] border-b border-border-table text-xs text-text-muted">
                      {item.releaseYear ?? '—'}
                    </td>
                    <td className="px-2 py-[5px] border-b border-border-table text-accent font-semibold text-sm">
                      {item.rating ? item.rating.toFixed(1) : '—'}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-sm text-text-muted">
                    Inga titlar att visa
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-surface border border-border-main rounded-sm">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-[7px] px-3 py-2">
            {filtered.map(item => {
              const poster = posterUrl(item.posterPath, 'w342');
              const href = item.mediaType === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;
              return (
                <Link key={item.tmdbId} href={href} className="no-underline text-text-primary">
                  <div className="aspect-[2/3] bg-[#ddd8d0] rounded-sm mb-[3px] relative overflow-hidden">
                    {poster && (
                      <img src={poster} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                    )}
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
