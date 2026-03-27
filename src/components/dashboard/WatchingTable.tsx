'use client';

import { useState } from 'react';
import Link from 'next/link';
import { posterUrl } from '@/lib/tmdb/client';
import { useTVShow } from '@/hooks/useTMDB';
import { useAuth } from '@/hooks/useAuth';
import { getProvider } from '@/lib/tmdb/providers';
import type { WatchlistItem } from '@/types';
import SeriesDetail from '@/components/tv/SeriesDetail';

type TabFilter = 'all' | 'tv' | 'movie';

interface WatchingTableProps {
  items: WatchlistItem[];
}

function ExpandedRow({ tmdbId }: { tmdbId: number }) {
  const { data: show, isLoading } = useTVShow(tmdbId);
  if (isLoading) return <tr><td colSpan={6} className="px-3 py-2 text-sm text-text-muted">Laddar...</td></tr>;
  if (!show) return null;
  return (
    <tr>
      <td colSpan={6} className="p-0">
        <SeriesDetail show={show} />
      </td>
    </tr>
  );
}

export default function WatchingTable({ items }: WatchingTableProps) {
  const [filter, setFilter] = useState<TabFilter>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const filtered = items.filter(i =>
    filter === 'all' || i.mediaType === filter
  );

  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
      <div className="flex items-center justify-between px-3 py-[6px] border-b border-border-light">
        <div className="flex items-center">
          <span className="text-sm font-bold text-text-secondary">Tittar på</span>
          <div className="flex gap-[1px] ml-[10px]">
            {(['all', 'tv', 'movie'] as const).map(tab => (
              <span
                key={tab}
                onClick={() => setFilter(tab)}
                className={`px-[7px] py-[2px] text-xs rounded-sm cursor-pointer ${
                  filter === tab
                    ? 'bg-accent text-white'
                    : 'text-text-muted'
                }`}
              >
                {tab === 'all' ? 'Alla' : tab === 'tv' ? 'Serier' : 'Film'}
              </span>
            ))}
          </div>
        </div>
        <Link href="/my/watching" className="text-xs text-accent no-underline">
          Alla {items.length} →
        </Link>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="text-left px-2 py-1 text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header w-[36px]"></th>
            <th className="text-left px-2 py-1 text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Titel</th>
            <th className="hidden md:table-cell text-left px-2 py-1 text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Nästa avsnitt</th>
            <th className="hidden md:table-cell text-left px-2 py-1 text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Progress</th>
            <th className="hidden md:table-cell text-left px-2 py-1 text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Var</th>
            <th className="text-left px-2 py-1 text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Betyg</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(item => {
            const poster = posterUrl(item.posterPath, 'w92');
            const href = item.mediaType === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;
            const nextEp = item.lastWatchedSeason && item.lastWatchedEpisode
              ? `S${item.lastWatchedSeason}E${item.lastWatchedEpisode + 1}`
              : item.mediaType === 'tv' ? 'S1E1' : '—';
            const isExpanded = expandedId === item.tmdbId;

            return (
              <WatchingRow
                key={item.tmdbId}
                item={item}
                poster={poster}
                href={href}
                nextEp={nextEp}
                isExpanded={isExpanded}
                onToggle={() => setExpandedId(isExpanded ? null : item.tmdbId)}
              />
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-center text-sm text-text-muted">
                Inga titlar att visa
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function WatchingRow({ item, poster, href, nextEp, isExpanded, onToggle }: {
  item: WatchlistItem;
  poster: string | null;
  href: string;
  nextEp: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={item.mediaType === 'tv' ? onToggle : undefined}
        className={`${item.mediaType === 'tv' ? 'cursor-pointer' : ''} hover:[&>td]:bg-surface-hover`}
      >
        <td className="px-2 py-[5px] border-b border-border-table">
          <Link href={href} onClick={e => e.stopPropagation()}>
            {poster ? (
              <img src={poster} alt="" className="w-[26px] h-[39px] rounded-sm object-cover" />
            ) : (
              <div className="w-[26px] h-[39px] rounded-sm bg-[#ddd8d0]" />
            )}
          </Link>
        </td>
        <td className="px-2 py-[5px] border-b border-border-table">
          <div className="font-semibold text-base">{item.title}</div>
          <div className="text-xs text-text-muted">
            {item.releaseYear ?? '—'}
          </div>
        </td>
        <td className="hidden md:table-cell px-2 py-[5px] border-b border-border-table text-sm text-text-secondary">
          {nextEp}
        </td>
        <td className="hidden md:table-cell px-2 py-[5px] border-b border-border-table">
          <div className="flex items-center gap-1">
            <div className="w-[48px] h-[3px] bg-[#e5e0d8] rounded-[1px] overflow-hidden">
              <div className="h-full bg-accent rounded-[1px]" style={{ width: '0%' }} />
            </div>
            <span className="text-xs text-[#bbb]">—</span>
          </div>
        </td>
        <td className="hidden md:table-cell px-2 py-[5px] border-b border-border-table">
          <ProviderPills providerIds={item.providers} />
        </td>
        <td className="px-2 py-[5px] border-b border-border-table text-accent font-semibold text-sm">
          {item.rating ? item.rating.toFixed(1) : '—'}
        </td>
      </tr>
      {isExpanded && item.mediaType === 'tv' && (
        <ExpandedRow tmdbId={item.tmdbId} />
      )}
    </>
  );
}

function ProviderPills({ providerIds }: { providerIds: number[] }) {
  const { user } = useAuth();
  const myProviders = user?.myProviders ?? [];
  if (!providerIds || providerIds.length === 0) return <span className="text-text-muted">—</span>;

  return (
    <span>
      {providerIds.slice(0, 2).map(id => {
        const p = getProvider(id);
        const isMine = myProviders.includes(id);
        return (
          <span
            key={id}
            className={`text-xxs px-1 py-[1px] border rounded-sm inline-block mr-[2px] ${
              isMine ? 'border-accent text-accent' : 'border-border-main text-text-muted'
            }`}
          >
            {p?.shortName ?? '?'}
          </span>
        );
      })}
    </span>
  );
}
