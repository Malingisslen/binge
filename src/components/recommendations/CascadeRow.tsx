'use client';

import Link from 'next/link';
import { useState, useCallback, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { useNotInterested } from '@/hooks/useNotInterested';
import { useSearchProviders } from '@/hooks/useSearchProviders';
import { useAuth } from '@/hooks/useAuth';
import { canonicalProviderId } from '@/lib/tmdb/providers';
import type { RowResult, RowTitle } from '@/types';

interface Props {
  result: RowResult;
}

export default function CascadeRow({ result }: Props) {
  const { rowSpec, visible, backingPool, isLoading } = result;
  const { add: addNotInterested } = useNotInterested();
  const { user } = useAuth();
  const myProviders = user?.myProviders ?? [];
  const [pulledIds, setPulledIds] = useState<number[]>([]); // titles dismissed; fill from pool

  // Compute current items: visible minus dismissed, then top-up from pool
  const items = useMemo(() => {
    const dismissed = new Set(pulledIds);
    const remaining = visible.filter(t => !dismissed.has(t.id));
    const need = visible.length - remaining.length;
    if (need > 0) {
      const fillers = backingPool.filter(t => !dismissed.has(t.id)).slice(0, need);
      remaining.push(...fillers);
    }
    return remaining;
  }, [visible, backingPool, pulledIds]);

  const providerMap = useSearchProviders(items);

  const onDismiss = useCallback((t: RowTitle) => {
    addNotInterested(t.id, t.media_type);
    setPulledIds(prev => [...prev, t.id]);
  }, [addNotInterested]);

  if (!isLoading && items.length < 4) return null;

  return (
    <section className="mb-6">
      <Link
        href={`/recommendations?row=${encodeURIComponent(rowSpec.rowKey)}`}
        className="flex items-center justify-between mb-2 group"
      >
        <h2 className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
          {rowSpec.label}
        </h2>
        <span className="text-xs text-accent flex items-center gap-1">
          visa fler <ChevronRight size={12} />
        </span>
      </Link>
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
        {items.map(t => (
          <RowCard
            key={`${t.media_type}-${t.id}`}
            title={t}
            myProviders={myProviders}
            providerMap={providerMap}
            onDismiss={() => onDismiss(t)}
          />
        ))}
        {isLoading && items.length === 0 && (
          <div className="text-xs text-text-muted py-8 px-2">Laddar…</div>
        )}
      </div>
    </section>
  );
}

interface CardProps {
  title: RowTitle;
  myProviders: number[];
  providerMap: Record<string, { flatrate?: { provider_id: number }[] }>;
  onDismiss: () => void;
}

function RowCard({ title, myProviders, providerMap, onDismiss }: CardProps) {
  const href = title.media_type === 'movie' ? `/movie/${title.id}` : `/tv/${title.id}`;
  const poster = title.poster_path
    ? `https://image.tmdb.org/t/p/w185${title.poster_path}`
    : null;
  const tWithName = title as RowTitle & { name?: string };
  const displayName = title.title ?? tWithName.name ?? '';
  const provs = providerMap[`${title.media_type}-${title.id}`]?.flatrate ?? [];
  const onMyService = provs.some(p => myProviders.includes(canonicalProviderId(p.provider_id)));

  return (
    <div className="relative shrink-0 w-[100px] group">
      <Link href={href}>
        {poster ? (
          <img
            src={poster}
            alt={displayName}
            width={100}
            height={150}
            loading="lazy"
            decoding="async"
            className="w-[100px] h-[150px] object-cover rounded-sm border border-border-main"
          />
        ) : (
          <div className="w-[100px] h-[150px] bg-surface border border-border-main rounded-sm flex items-center justify-center text-[9px] text-text-muted">
            Ingen poster
          </div>
        )}
      </Link>
      <button
        onClick={onDismiss}
        className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white text-xs rounded-sm opacity-0 group-hover:opacity-100"
        title="Inte intresserad"
        aria-label="Inte intresserad"
      >
        ×
      </button>
      <div className="mt-1 text-[10px] text-text-secondary line-clamp-2">{displayName}</div>
      <div className="flex gap-1 mt-1 flex-wrap">
        {(title.vote_average ?? 0) > 0 && (
          <span className="text-[9px] text-text-muted">{title.vote_average!.toFixed(1)}</span>
        )}
        {onMyService && <span className="text-[9px] text-accent">●</span>}
      </div>
    </div>
  );
}
