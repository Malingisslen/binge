'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { posterUrl } from '@/lib/tmdb/client';
import { shortSwedishWeekday } from '@/lib/utils';
import type { CalendarEntry } from '@/hooks/useCalendar';

function fmtShortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDate();
  const month = d.toLocaleDateString('sv-SE', { month: 'short' }).replace('.', '');
  return `${shortSwedishWeekday(iso)} ${day} ${month}`;
}

interface UpcomingCardsProps {
  entries: CalendarEntry[];
}

export default function UpcomingCards({ entries }: UpcomingCardsProps) {
  const upcoming = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAhead = new Date(today);
    weekAhead.setDate(today.getDate() + 7);
    return entries
      .filter(e => {
        const d = new Date(e.airDate);
        return d >= today && d < weekAhead;
      })
      .sort((a, b) => a.airDate.localeCompare(b.airDate))
      .slice(0, 6);
  }, [entries]);

  return (
    <div className="flex gap-[10px] mb-[14px] overflow-x-auto pb-1">
      {upcoming.map(e => {
        const poster = posterUrl(e.posterPath, 'w154');
        return (
          <Link
            key={`${e.tmdbId}-${e.episodeCode}`}
            href={`/tv/${e.tmdbId}/`}
            className="min-w-[220px] shrink-0 bg-surface border border-border-main rounded-sm px-3 py-[8px] flex gap-[10px] items-center no-underline text-text-primary hover:border-accent/40 transition-colors"
          >
            {poster ? (
              <img src={poster} alt="" className="w-[44px] h-[66px] rounded-sm object-cover shrink-0" loading="lazy" decoding="async" width={44} height={66} />
            ) : (
              <div className="w-[44px] h-[66px] rounded-sm bg-[#ddd8d0] shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate">{e.title}</div>
              <div className="text-xxs text-text-muted">
                {e.episodeCode}{e.provider ? ` · ${e.provider}` : ''}
              </div>
              <div className="text-xxs text-accent font-semibold mt-[2px]">
                {fmtShortDate(e.airDate)}
              </div>
            </div>
          </Link>
        );
      })}
      {upcoming.length < 6 && (
        <Link
          href="/calendar"
          className="min-w-[180px] shrink-0 bg-surface border border-border-main rounded-sm px-3 py-[8px] flex items-center justify-center text-center text-xxs text-text-muted no-underline hover:border-accent/40 transition-colors"
        >
          <span>Inga fler avsnitt denna vecka<br /><span className="text-accent">Kalender →</span></span>
        </Link>
      )}
    </div>
  );
}
