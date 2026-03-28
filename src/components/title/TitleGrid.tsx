'use client';

import type { TMDBSearchResult, TMDBProvider } from '@/types';
import TitleCard from './TitleCard';

interface TitleGridProps {
  items: TMDBSearchResult[];
  loading?: boolean;
  providerMap?: Record<string, TMDBProvider[]>;
}

function SkeletonCard() {
  return (
    <div>
      <div className="aspect-[2/3] bg-[#ddd8d0] rounded-sm mb-[3px] animate-pulse" />
      <div className="h-[12px] bg-[#ddd8d0] rounded-sm mb-[3px] w-3/4 animate-pulse" />
      <div className="h-[10px] bg-[#e5e0d8] rounded-sm w-1/2 animate-pulse" />
    </div>
  );
}

export default function TitleGrid({ items, loading, providerMap }: TitleGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-[10px] md:gap-[7px] px-3 py-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-[10px] md:gap-[7px] px-3 py-2">
      {items.map(item => (
        <TitleCard
          key={`${item.media_type ?? 'unknown'}-${item.id}`}
          item={item}
          providers={providerMap?.[`${item.media_type}-${item.id}`]}
        />
      ))}
    </div>
  );
}
