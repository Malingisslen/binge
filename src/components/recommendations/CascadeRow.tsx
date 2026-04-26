'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useSearchProviders } from '@/hooks/useSearchProviders';
import TitleCard from '@/components/title/TitleCard';
import type { RowResult } from '@/types';

interface Props {
  result: RowResult;
}

export default function CascadeRow({ result }: Props) {
  const { rowSpec, visible, backingPool, isLoading } = result;
  // Topp-up från backing pool så raden behåller sin längd när Quick-Add /
  // Inte intresserad-knapparna invaliderar excludedIds (titlar som
  // adderas/dismissas filtreras automatiskt bort i row-hookens useMemo
  // → visible krymper → vi fyller från pool tills vi når 20).
  const items = visible.length >= 20
    ? visible
    : [...visible, ...backingPool.slice(0, 20 - visible.length)];

  const providerMap = useSearchProviders(items);

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
        {items.map(t => {
          const flatrate = providerMap[`${t.media_type}-${t.id}`]?.flatrate ?? [];
          return (
            <div key={`${t.media_type}-${t.id}`} className="shrink-0 w-[120px]">
              <TitleCard item={t} providers={flatrate} showNotInterested />
            </div>
          );
        })}
        {isLoading && items.length === 0 && (
          <div className="text-xs text-text-muted py-8 px-2">Laddar…</div>
        )}
      </div>
    </section>
  );
}
