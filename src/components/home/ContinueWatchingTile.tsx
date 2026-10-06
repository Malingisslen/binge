'use client';

import Link from 'next/link';
import { titleHref, posterUrl } from '@/lib/tmdb/client';
import { toneForGenreIds, toneForId } from '@/lib/duotone';
import DuotonePoster from '@/components/ui/DuotonePoster';
import type { ContinueWatchingEntry } from '@/lib/continueWatching';
import MarkEpisodeSeenButton from './MarkEpisodeSeenButton';

// BIN-86 — "Fortsätt titta". Progress-driven Up Next row, complementing the
// air-date focal. Shows where you left off + a jump-back link to the series
// page, and a "Sett" button when the next episode is known (BIN-1442). The button
// sits BESIDE the link, never inside it: a button nested in an <a> is invalid
// and its click would also navigate. Picking is pure (lib/continueWatching).

export default function ContinueWatchingTile({ entries }: { entries: ContinueWatchingEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <section className="mt-[18px] mb-[14px]">
      <div className="flex items-baseline justify-between mb-[8px]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-ink-3">
          Fortsätt titta
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[10px]">
        {entries.map(({ item, seen, behind, next }) => {
          const tone = item.genreIds && item.genreIds.length > 0
            ? toneForGenreIds(item.genreIds)
            : toneForId(item.tmdbId);
          const poster = posterUrl(item.posterPath, 'w185');
          return (
            <div
              key={item.tmdbId}
              className="flex gap-[8px] items-center bg-surface border border-rule rounded-sm p-[8px] hover:shadow-lift transition-shadow"
            >
              <Link
                href={titleHref('tv', item.tmdbId)}
                className="no-underline flex flex-1 min-w-0 gap-[10px] items-center"
                style={{ color: 'var(--ink)' }}
              >
                <span className="shrink-0 w-[40px]">
                  {poster && (
                    <DuotonePoster src={poster} alt={item.title} tone={tone} width={40} height={60} />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-ink truncate">{item.title}</span>
                  <span className="block text-xxs text-ink-3 mt-[3px]">
                    {behind && <span className="text-acc-deep font-semibold">Ligger efter · </span>}
                    {seen ? `senast ${seen}` : 'påbörjad'}
                  </span>
                </span>
              </Link>
              {next && (
                <MarkEpisodeSeenButton
                  tmdbId={item.tmdbId}
                  season={next.season}
                  episode={next.episode}
                  className="btn btn-ghost btn-sm shrink-0"
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
