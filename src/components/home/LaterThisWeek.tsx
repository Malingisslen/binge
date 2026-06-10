'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { posterUrl } from '@/lib/tmdb/client';
import { toneForId } from '@/lib/duotone';
import { shortSwedishWeekday } from '@/lib/utils';
import type { CalendarEntry } from '@/hooks/useCalendar';
import { entryKey, entryHref, entryMetaLine } from '@/lib/calendar/entry';

// Direction H filmstrip: up to 5 upcoming events (TV episodes or digital movie
// releases) for the rest of this week. Each card is a duotone 2:3 poster +
// title + meta line (day · S/E or "Digital release" · provider — provider
// visas när TMDB vet var titeln streamas, se streamingProviderName i
// buildEntries; saknas data visas bara dag · kod).
//
// 5-taket är medvetet (Direction H-layouten). H2: när fler händelser finns
// visar metan "5 av N händelser" + en "+N till →"-länk till /calendar så
// hemvyn och WeekStrips ×N-räkning synbart går ihop.
//
// `excludeKey` lets the caller hide an entry that's already shown in the
// focal block, so we don't repeat tonight's event here.

const MAX_CARDS = 5;

interface Props {
  entries: CalendarEntry[];
  excludeKey?: string; // entryKey of the focal event
}

export default function LaterThisWeek({ entries, excludeKey }: Props) {
  const { upcoming, total } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAhead = new Date(today);
    weekAhead.setDate(today.getDate() + 7);

    const all = entries
      .filter(e => {
        if (excludeKey && entryKey(e) === excludeKey) return false;
        const d = new Date(e.airDate + 'T00:00:00');
        return d >= today && d < weekAhead;
      })
      .sort((a, b) => a.airDate.localeCompare(b.airDate));
    return { upcoming: all.slice(0, MAX_CARDS), total: all.length };
  }, [entries, excludeKey]);

  const overflow = total - upcoming.length;

  if (upcoming.length === 0) return null;

  return (
    <section aria-labelledby="hem-later-h3">
      <div className="sect-h">
        <h3 id="hem-later-h3">Senare i veckan</h3>
        <span className="meta">
          {overflow > 0 ? (
            <>
              {upcoming.length} av {total} händelser ·{' '}
              <Link href="/calendar/" style={{ color: 'inherit' }}>
                +{overflow} till →
              </Link>
            </>
          ) : (
            <>{upcoming.length} {upcoming.length === 1 ? 'händelse' : 'händelser'}</>
          )}
        </span>
      </div>
      <div className="filmstrip">
        {upcoming.map(e => {
          const poster = posterUrl(e.posterPath, 'w342');
          const tone = toneForId(e.tmdbId);
          const day = shortSwedishWeekday(e.airDate);
          return (
            <Link key={entryKey(e)} href={entryHref(e)} className="film-card">
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
                <span className="day">{day}</span> · {entryMetaLine(e)}
                {e.provider ? ` · ${e.provider}` : ''}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
