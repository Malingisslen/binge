'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getWeekStart, getWeekNumber } from '@/hooks/useCalendar';

// The persistent 7-day strip that sits at the top of every page. Today wears
// the plum picker wash + 2px plum rule (semantic = "where in time the user
// currently is"). Saffran is reserved for "now / live / decisive" (CTA,
// tonight's airing episode), not for today.
//
// `countsByDay` is optional and keyed by `YYYY-MM-DD` (local) — pages that
// already render the calendar entries can pass them in; pages that don't
// leave them out and the strip shows a "—" placeholder rather than firing
// a TMDB fetch from the chrome.

const DAY_LABELS = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'] as const;

export default function WeekStrip({
  countsByDay,
}: {
  countsByDay?: Record<string, number>;
}) {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);

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
    return <div className="topbar-week h-[64px]" aria-hidden="true" />;
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
        const count = countsByDay?.[key] ?? 0;
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
