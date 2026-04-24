'use client';

import Link from 'next/link';
import { usePublicList } from '@/hooks/useLists';
import { posterUrl } from '@/lib/tmdb/client';

export default function ListPageClient({ listId }: { listId: string }) {
  const { data: list, isLoading } = usePublicList(listId);

  if (isLoading) return <div className="text-sm text-text-muted py-4">Laddar...</div>;
  if (!list) return <div className="text-sm text-text-muted py-4">Listan hittades inte.</div>;

  return (
    <div>
      <h1 className="text-[18px] font-bold text-text-primary mb-1">{list.title}</h1>
      {list.description && (
        <p className="text-xs text-text-muted mb-2">{list.description}</p>
      )}
      <span className="text-xxs text-text-muted">{list.items.length} {list.items.length === 1 ? 'titel' : 'titlar'}</span>

      <div className="bg-surface border border-border-main rounded-sm mt-3">
        <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-[10px] md:gap-[7px] px-3 py-2">
          {list.items.map(item => {
            const poster = posterUrl(item.posterPath, 'w342');
            const href = item.mediaType === 'movie' ? `/movie/${item.tmdbId}/` : `/tv/${item.tmdbId}/`;
            return (
              <Link key={item.tmdbId} href={href} className="no-underline text-text-primary">
                <div className="aspect-[2/3] bg-[#ddd8d0] rounded-sm mb-[3px] overflow-hidden">
                  {poster && <img src={poster} alt={item.title} className="w-full h-full object-cover" loading="lazy" decoding="async" width={342} height={513} />}
                </div>
                <div className="text-xs font-semibold truncate">{item.title}</div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
