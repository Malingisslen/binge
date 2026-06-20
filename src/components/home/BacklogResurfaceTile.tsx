'use client';

import Link from 'next/link';
import { titleHref, posterUrl } from '@/lib/tmdb/client';
import { getProvider, type SwedishProvider } from '@/lib/tmdb/providers';
import { toneForGenreIds, toneForId } from '@/lib/duotone';
import DuotonePoster from '@/components/ui/DuotonePoster';
import ProviderDot from '@/components/ui/ProviderDot';
import type { WatchlistItem } from '@/types';

// BIN-88 — "ville se — finns nu på din tjänst". A small Home tile that
// resurfaces forgotten vill_se titles streamable on a service the user already
// pays for. The picking is pure (lib/backlogResurface); this just renders.

function matchedProvider(item: WatchlistItem, mine: Set<number>): SwedishProvider | undefined {
  const id = (item.providers ?? []).find(p => mine.has(p));
  return id != null ? getProvider(id) : undefined;
}

export default function BacklogResurfaceTile({
  items,
  myProviders,
}: {
  items: WatchlistItem[];
  myProviders: number[];
}) {
  if (items.length === 0) return null;
  const mine = new Set(myProviders);

  return (
    <section className="mt-[18px] mb-[14px]">
      <div className="flex items-baseline justify-between mb-[8px]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-muted">
          Ville se — finns nu på din tjänst
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[10px]">
        {items.map(item => {
          const prov = matchedProvider(item, mine);
          const tone = item.genreIds && item.genreIds.length > 0
            ? toneForGenreIds(item.genreIds)
            : toneForId(item.tmdbId);
          const poster = posterUrl(item.posterPath, 'w185');
          return (
            <Link
              key={item.tmdbId}
              href={titleHref(item.mediaType, item.tmdbId)}
              className="no-underline flex gap-[10px] items-center bg-surface border border-border-main rounded-sm p-[8px] hover:shadow-lift transition-shadow"
              style={{ color: 'var(--ink)' }}
            >
              <span className="shrink-0 w-[40px]">
                {poster && (
                  <DuotonePoster src={poster} alt={item.title} tone={tone} width={40} height={60} />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-text-primary truncate">{item.title}</span>
                {prov && (
                  <span className="inline-flex items-center gap-[5px] mt-[3px]">
                    <ProviderDot color={prov.color} size={6} />
                    <span className="text-xxs text-text-muted">finns på {prov.shortName}</span>
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
