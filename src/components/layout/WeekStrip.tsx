'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getWeekStart, getWeekNumber, useCalendarEntries } from '@/hooks/useCalendar';

// The persistent 7-day strip that sits at the top of every page. Today wears
// the plum picker wash + 2px plum rule (semantic = "where in time the user
// currently is"). Saffran is reserved for "now / live / decisive" (CTA,
// tonight's airing episode), not for today.
//
// Counts per day deriveras direkt från `useCalendarEntries()`. Den delar
// react-query-cache med hem- och kalendersidorna (queryKeys `['tv', id]` +
// `['tv-season', id, num]`) — så på sidor som redan har datan är detta gratis.
// På övriga sidor är det en engångskostnad per session (staleTime 10–30 min).

const DAY_LABELS = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'] as const;

export default function WeekStrip() {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);

  const { entries } = useCalendarEntries();
  const countsByDay = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries) {
      m[e.airDate] = (m[e.airDate] ?? 0) + 1;
    }
    return m;
  }, [entries]);

  const week = useMemo(() => {
    if (!today) return null;
    const monday = getWeekStart(today);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
    return { monday, days, weekNumber: getWeekNumber(today), year: monday.getFullYear() };
  }, [today]);

  if (!week || !today) {
    // Pre-mount: rendera STRUKTUR med statiska dagsetiketter men placeholder
    // för dynamiska värden (vecknummer, datum). Använder Link-element istället
    // för span så att DOM-typen inte byts vid hydration — React kan
    // uppdatera href/text in-place utan att replace:a <a>-elementen. Eliminerar
    // både content-pop OCH element-type-flickern.
    return (
      <div className="topbar-week" role="navigation" aria-label="Veckonavigering" aria-hidden="true">
        <Link href="/calendar/" prefetch={false} className="vnum">
          <span className="v">&nbsp;</span>
          <span className="yr">&nbsp;</span>
        </Link>
        {DAY_LABELS.map(label => (
          <Link key={label} href="/calendar/" prefetch={false} className="day">
            <span className="lab">{label}</span>
            <span className="num">&nbsp;</span>
            <span className="count" aria-hidden="true">&nbsp;</span>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="topbar-week" role="navigation" aria-label="Veckonavigering">
      <Link href="/calendar/" className="vnum">
        <span className="v">v{week.weekNumber}</span>
        <span className="yr">{week.year}</span>
        <span className="sr-only">, vecka {week.weekNumber}</span>
      </Link>
      {week.days.map((d, i) => {
        const isToday = sameDay(d, today);
        const key = isoDateKey(d);
        const count = countsByDay[key] ?? 0;
        return (
          <Link
            key={key}
            href={`/calendar/?day=${key}`}
            className={`day${isToday ? ' today' : ''}`}
          >
            <span className="lab">{DAY_LABELS[i]}</span>
            <span className="num">{d.getDate()}</span>
            <span className="count">
              {count > 0 ? (
                <>
                  <strong>{count}</strong>
                  <span className="sr-only"> avsnitt</span>
                </>
              ) : (
                <span aria-hidden="true">—</span>
              )}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function isoDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
