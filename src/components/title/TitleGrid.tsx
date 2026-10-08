'use client';

import type { TMDBSearchResult, TMDBProvider } from '@/types';
import TitleCard from './TitleCard';

interface TitleGridProps {
  items: TMDBSearchResult[];
  loading?: boolean;
  providerMap?: Record<string, TMDBProvider[]>;
  showNotInterested?: boolean;
}

function SkeletonCard() {
  return (
    <div>
      <div className="aspect-[2/3] bg-rule-2 rounded-sm mb-1 animate-pulse" />
      <div className="h-[12px] bg-rule-2 rounded-sm mb-1 w-3/4 animate-pulse" />
      <div className="h-[10px] bg-rule rounded-sm w-1/2 animate-pulse" />
    </div>
  );
}

export default function TitleGrid({ items, loading, providerMap, showNotInterested }: TitleGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2.5 md:gap-2 px-3 py-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2.5 md:gap-2 px-3 py-2">
      {items.map(item => (
        <TitleCard
          key={`${item.media_type ?? 'unknown'}-${item.id}`}
          item={item}
          providers={providerMap?.[`${item.media_type}-${item.id}`]}
          showNotInterested={showNotInterested}
        />
      ))}
    </div>
  );
}
