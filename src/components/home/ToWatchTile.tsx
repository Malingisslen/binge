'use client';

import Link from 'next/link';
import { titleHref, posterUrl } from '@/lib/tmdb/client';
import { toneForGenreIds, toneForId } from '@/lib/duotone';
import DuotonePoster from '@/components/ui/DuotonePoster';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { cardClass } from '@/components/ui/Card';
import { TO_WATCH_ROW_LABELS, agoText, type ToWatchRow } from '@/lib/toWatch';

// "Nytt för dig" on Hem: the top few titles of the library view of the same name, and the way
// into the rest. The picking is pure (lib/toWatch), so this only draws.

function subtitle(row: ToWatchRow, now: Date): string {
  if (row.group === 'nya' && row.newestAirDate) return `Nytt avsnitt ${agoText(new Date(`${row.newestAirDate}T00:00:00`), now)}`;
  return TO_WATCH_ROW_LABELS[row.group];
}

export default function ToWatchTile({ highlights, total }: { highlights: ToWatchRow[]; total: number }) {
  if (highlights.length === 0) return null;
  const now = new Date();

  return (
    <section className="mt-5 mb-3.5">
      <div className="flex items-baseline justify-between mb-2">
        <Eyebrow as="h2" size="xs">Nytt för dig</Eyebrow>
        <Link href="/my/nytt-for-dig/" className="text-xs font-semibold text-acc-deep no-underline">
          Visa alla {total}
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {highlights.map(row => {
          const { item } = row;
          const tone = item.genreIds && item.genreIds.length > 0 ? toneForGenreIds(item.genreIds) : toneForId(item.tmdbId);
          const poster = posterUrl(item.posterPath, 'w185');
          return (
            <Link
              key={`${item.mediaType}-${item.tmdbId}`}
              href={titleHref(item.mediaType, item.tmdbId)}
              className={cardClass('flex gap-2 items-center p-2 no-underline text-ink hover:shadow-lift transition-shadow')}
            >
              <span className="shrink-0 w-10">
                {poster && <DuotonePoster src={poster} alt="" tone={tone} width={40} height={60} />}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-ink truncate">{item.title}</span>
                <span className={`block text-xxs mt-1 ${row.group === 'nya' ? 'text-acc-deep font-semibold' : 'text-ink-3'}`}>
                  {subtitle(row, now)}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
