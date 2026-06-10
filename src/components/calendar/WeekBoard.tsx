'use client';

import { useMemo } from 'react';
import type { CalendarEntry } from '@/hooks/useCalendar';
import { entryKey } from '@/lib/calendar/entry';
import { summarizeCounts } from '@/lib/calendar/summary';
import EventCard from './EventCard';

// 7-column week board. Today's column gets the plum wash + 2px top rule.
// Episodes airing today are flagged `isTonight` on the card.
//
// K4 — passerade dagar: medvetet val att VISA deras avsnitt (pipelinen har
// hela säsongen, inklusive redan sända avsnitt) men dämpade via `.past`-
// klassen, så veckan läses som ett helt schema och WeekBoard aldrig påstår
// "— inget —" om en dag där avsnitt faktiskt sändes. Undantag: filmsläpp
// byggs bara framåt (buildMovieEntries filtrerar bort passerade datum), så
// en passerad dag kan sakna ett filmsläpp som fanns där när dagen var aktuell.

const DAY_LABELS = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'] as const;

interface Props {
  weekStart: Date;
  entries: readonly CalendarEntry[];
}

function isoKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export default function WeekBoard({ weekStart, entries }: Props) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    d.setHours(0, 0, 0, 0);
    return d;
  }), [weekStart]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const todayKey = isoKey(today);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      const list = map.get(e.airDate) ?? [];
      list.push(e);
      map.set(e.airDate, list);
    }
    return map;
  }, [entries]);

  return (
    <div className="week-board" role="region" aria-label="Veckans avsnitt">
      {days.map((d, i) => {
        const key = isoKey(d);
        const isToday = sameDay(d, today);
        const isPast = d.getTime() < today.getTime();
        const dayEntries = entriesByDay.get(key) ?? [];
        const lab = DAY_LABELS[i];
        return (
          <div key={key} className={`col${isToday ? ' today' : ''}${isPast ? ' past' : ''}`}>
            <div className="col-h">
              <div className="lab">{lab}{isToday ? ' · idag' : ''}{isPast ? ' · passerad' : ''}</div>
              <div className="date">{d.getDate()}</div>
              <div className="meta">
                {summarizeCounts(dayEntries)}
              </div>
            </div>
            <div className="col-body">
              {dayEntries.length === 0 ? (
                <div className="empty">— inget —</div>
              ) : (
                dayEntries.map(e => (
                  <EventCard
                    key={entryKey(e)}
                    entry={e}
                    isTonight={key === todayKey}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
