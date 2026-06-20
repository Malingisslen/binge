'use client';

import Link from 'next/link';
import { titleHref, posterUrl } from '@/lib/tmdb/client';
import { toneForGenreIds, toneForId } from '@/lib/duotone';
import DuotonePoster from '@/components/ui/DuotonePoster';
import type { ContinueWatchingEntry } from '@/lib/continueWatching';

// BIN-86 — "Fortsätt titta". Progress-driven Up Next row, complementing the
// air-date focal. Shows where you left off + a jump-back link to the series
// page (where the next episode can be marked with the season data already
// loaded there). Picking is pure (lib/continueWatching); this just renders.

export default function ContinueWatchingTile({ entries }: { entries: ContinueWatchingEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <section className="mt-[18px] mb-[14px]">
      <div className="flex items-baseline justify-between mb-[8px]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-muted">
          Fortsätt titta
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[10px]">
        {entries.map(({ item, seen, behind }) => {
          const tone = item.genreIds && item.genreIds.length > 0
            ? toneForGenreIds(item.genreIds)
            : toneForId(item.tmdbId);
          const poster = posterUrl(item.posterPath, 'w185');
          return (
            <Link
              key={item.tmdbId}
              href={titleHref('tv', item.tmdbId)}
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
                <span className="block text-xxs text-text-muted mt-[3px]">
                  {behind && <span className="text-accent font-semibold">Ligger efter · </span>}
                  {seen ? `senast ${seen}` : 'påbörjad'}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
