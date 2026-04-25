'use client';

import { useState } from 'react';
import Link from 'next/link';
import { posterUrl, titleHref } from '@/lib/tmdb/client';
import { useTVShow } from '@/hooks/useTMDB';
import { useAuth } from '@/hooks/useAuth';
import { getProvider } from '@/lib/tmdb/providers';
import type { WatchlistItem } from '@/types';
import SeriesDetail from '@/components/tv/SeriesDetail';
import RatingStars from '@/components/title/RatingStars';

interface WatchingTableProps {
  items: WatchlistItem[];
}

function ExpandedRow({ tmdbId, onClose }: { tmdbId: number; onClose: () => void }) {
  const { data: show, isLoading } = useTVShow(tmdbId);
  if (isLoading) return <tr><td colSpan={6} className="px-3 py-2 text-sm text-text-muted">Laddar...</td></tr>;
  if (!show) return null;
  return (
    <tr>
      <td colSpan={6} className="p-0" onClick={e => e.stopPropagation()}>
        <SeriesDetail show={show} onClose={onClose} />
      </td>
    </tr>
  );
}

export default function WatchingTable({ items }: WatchingTableProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const visible = items.slice(0, 8);
  const hasMore = items.length > visible.length;

  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
      <div className="flex items-center justify-between px-3 py-[6px] border-b border-border-light">
        <span className="text-sm font-bold text-text-secondary">
          Följer <span className="text-text-muted font-normal">· {items.length} {items.length === 1 ? 'titel' : 'titlar'}</span>
        </span>
        <Link href="/my/series" className="text-xs text-accent no-underline">
          Visa alla →
        </Link>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="text-left px-3 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header w-[44px]"></th>
            <th className="text-left px-3 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Titel</th>
            <th className="text-left px-3 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Streamas på</th>
            <th className="text-left px-3 py-[6px] text-xxs text-text-muted font-semibold uppercase tracking-[0.5px] border-b border-border-light bg-cal-header">Betyg</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((item, idx) => {
            const poster = posterUrl(item.posterPath, 'w92');
            const href = titleHref(item.mediaType, item.tmdbId);
            const isExpanded = expandedId === item.tmdbId;

            return (
              <WatchingRow
                key={item.tmdbId}
                item={item}
                poster={poster}
                href={href}
                isExpanded={isExpanded}
                onToggle={() => setExpandedId(isExpanded ? null : item.tmdbId)}
                striped={idx % 2 === 1}
              />
            );
          })}
          {visible.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-center text-sm text-text-muted">
                Inga titlar att visa
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {hasMore && (
        <div className="px-3 py-[6px] text-center border-t border-border-light">
          <Link href="/my/series" className="text-xs text-accent no-underline">
            Visa alla {items.length} →
          </Link>
        </div>
      )}
    </div>
  );
}

function WatchingRow({ item, poster, href, isExpanded, onToggle, striped }: {
  item: WatchlistItem;
  poster: string | null;
  href: string;
  isExpanded: boolean;
  onToggle: () => void;
  striped: boolean;
}) {
  const bgClass = striped ? 'bg-surface-hover/40' : '';
  return (
    <>
      <tr
        onClick={item.mediaType === 'tv' ? onToggle : undefined}
        className={`${item.mediaType === 'tv' ? 'cursor-pointer' : ''} hover:[&>td]:bg-surface-hover ${bgClass}`}
      >
        <td className="px-3 py-[5px] border-b border-border-table w-[44px]">
          <Link href={href} onClick={e => e.stopPropagation()}>
            {poster ? (
              <img src={poster} alt="" className="w-[28px] h-[42px] rounded-sm object-cover" loading="lazy" decoding="async" width={28} height={42} />
            ) : (
              <div className="w-[28px] h-[42px] rounded-sm bg-[#ddd8d0]" />
            )}
          </Link>
        </td>
        <td className="px-3 py-[5px] border-b border-border-table">
          <div className="font-semibold text-xs">
            {item.title}
            {item.rewatchCount > 0 && (
              <span className="ml-1 text-xxs text-text-muted font-normal">x{item.rewatchCount + 1}</span>
            )}
          </div>
          <div className="text-xxs text-text-muted">
            {item.releaseYear ?? '—'}
          </div>
        </td>
        <td className="px-3 py-[5px] border-b border-border-table">
          <ProviderPills providerIds={item.providers} />
        </td>
        <td className="px-3 py-[5px] border-b border-border-table">
          {item.rating ? (
            <span className="inline-flex items-center gap-[4px]">
              <RatingStars rating={item.rating} readonly size="sm" />
              <span className="text-xxs text-text-muted">{item.rating.toFixed(1)}</span>
            </span>
          ) : (
            <span className="text-text-muted">—</span>
          )}
        </td>
      </tr>
      {isExpanded && item.mediaType === 'tv' && (
        <ExpandedRow tmdbId={item.tmdbId} onClose={onToggle} />
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
      {providerIds.map(id => ({ id, p: getProvider(id) })).filter((x): x is { id: number; p: NonNullable<ReturnType<typeof getProvider>> } => !!x.p).slice(0, 2).map(({ id, p }) => {
        const isMine = myProviders.includes(id);
        return (
          <span
            key={id}
            className={`text-xxs px-1 py-[1px] border rounded-sm inline-block mr-[2px] ${
              isMine ? 'border-accent text-accent' : 'border-border-main text-text-muted'
            }`}
          >
            {p.shortName}
          </span>
        );
      })}
    </span>
  );
}
