'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { posterUrl } from '@/lib/tmdb/client';
import { toneForId } from '@/lib/duotone';
import { shortSwedishWeekday } from '@/lib/utils';
import type { CalendarEntry } from '@/hooks/useCalendar';

// Direction H filmstrip: up to 5 upcoming TV episodes (or films, but we
// only track episodes here) for the rest of this week. Each card is a
// duotone 2:3 poster + title + meta line (day · S/E · provider).
//
// `excludeKey` lets the caller hide an entry that's already shown in the
// focal block, so we don't repeat tonight's episode here.

interface Props {
  entries: CalendarEntry[];
  excludeKey?: string; // `${tmdbId}-${episodeCode}` of the focal episode
}

function entryKey(e: CalendarEntry): string {
  return `${e.tmdbId}-${e.episodeCode}`;
}

export default function LaterThisWeek({ entries, excludeKey }: Props) {
  const upcoming = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAhead = new Date(today);
    weekAhead.setDate(today.getDate() + 7);

    return entries
      .filter(e => {
        if (excludeKey && entryKey(e) === excludeKey) return false;
        const d = new Date(e.airDate + 'T00:00:00');
        return d >= today && d < weekAhead;
      })
      .sort((a, b) => a.airDate.localeCompare(b.airDate))
      .slice(0, 5);
  }, [entries, excludeKey]);

  if (upcoming.length === 0) return null;

  return (
    <section aria-labelledby="hem-later-h3">
      <div className="sect-h">
        <h3 id="hem-later-h3">Senare i veckan</h3>
        <span className="meta">
          {upcoming.length} {upcoming.length === 1 ? 'avsnitt' : 'avsnitt'}
        </span>
      </div>
      <div className="filmstrip">
        {upcoming.map(e => {
          const poster = posterUrl(e.posterPath, 'w342');
          const tone = toneForId(e.tmdbId);
          const day = shortSwedishWeekday(e.airDate);
          return (
            <Link key={entryKey(e)} href={`/tv/${e.tmdbId}/`} className="film-card">
              <div className={`poster duo-${tone}`}>
                {poster ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={poster}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={342}
                    height={513}
                  />
                ) : null}
              </div>
              <div className="ttl">{e.title}</div>
              <div className="meta">
                <span className="day">{day}</span> · {e.episodeCode}
                {e.provider ? ` · ${e.provider}` : ''}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
