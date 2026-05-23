'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getWeekStart, getWeekNumber, useCalendarEntries, type CalendarEntry } from '@/hooks/useCalendar';
import { useWatchlist } from '@/hooks/useWatchlist';

// The persistent 7-day strip that sits at the top of every page. Today wears
// the plum picker wash + 2px plum rule (semantic = "where in time the user
// currently is"). Saffran is reserved for "now / live / decisive" (CTA,
// tonight's airing episode), not for today.
//
// Per dag visar vi den högst rankade serien + ev. avsnittsantal (×N) och en
// "+M till"-hint om fler serier släpper samma dag. Klick på cellen går till
// /calendar/?day=YYYY-MM-DD där allt listas. Aggregeringen kör mot
// `useCalendarEntries()`-cachen — gratis på sidor som redan har datan.

const DAY_LABELS = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'] as const;

interface DaySeries {
  tmdbId: number;
  title: string;
  episodes: number;
  rating: number | null;
}

function aggregateByDay(
  entries: CalendarEntry[],
  ratingFor: (tmdbId: number) => number | null,
): Record<string, DaySeries[]> {
  const byDay = new Map<string, Map<number, DaySeries>>();
  for (const e of entries) {
    let day = byDay.get(e.airDate);
    if (!day) {
      day = new Map();
      byDay.set(e.airDate, day);
    }
    const existing = day.get(e.tmdbId);
    if (existing) {
      existing.episodes += 1;
    } else {
      day.set(e.tmdbId, {
        tmdbId: e.tmdbId,
        title: e.title,
        episodes: 1,
        rating: ratingFor(e.tmdbId),
      });
    }
  }
  const result: Record<string, DaySeries[]> = {};
  for (const [day, map] of byDay) {
    const series = Array.from(map.values());
    // Rating desc (null sist), tie-break på titel för stabil ordning över renders.
    series.sort((a, b) => {
      const ra = a.rating ?? -1;
      const rb = b.rating ?? -1;
      if (ra !== rb) return rb - ra;
      return a.title.localeCompare(b.title, 'sv');
    });
    result[day] = series;
  }
  return result;
}

export default function WeekStrip() {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);

  const { entries } = useCalendarEntries();
  const { getItem } = useWatchlist();
  const seriesByDay = useMemo(
    () => aggregateByDay(entries, (id) => getItem(id)?.rating ?? null),
    [entries, getItem],
  );

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
        const series = seriesByDay[key] ?? [];
        const top = series[0];
        const rest = series.length - 1;
        // Popovern är bara meningsfull när den tillför info utöver vad cellen
        // redan visar inline — alltså flera serier samma dag ELLER flera
        // avsnitt av samma serie. Annars duplicerar den bara titeln.
        const showPop = series.length > 1 || (top != null && top.episodes > 1);
        return (
          <Link
            key={key}
            href={`/calendar/?day=${key}`}
            className={`day${isToday ? ' today' : ''}`}
          >
            <span className="lab">{DAY_LABELS[i]}</span>
            <span className="num">{d.getDate()}</span>
            <span className="count">
              {top ? (
                <>
                  <strong>{top.title}</strong>
                  {top.episodes > 1 && (
                    <>
                      <span className="ep-x" aria-hidden="true"> ×{top.episodes}</span>
                      <span className="sr-only">, {top.episodes} avsnitt</span>
                    </>
                  )}
                  {rest > 0 && (
                    <>
                      <span className="more" aria-hidden="true"> +{rest}</span>
                      <span className="sr-only">, plus {rest} {rest === 1 ? 'serie till' : 'serier till'}</span>
                    </>
                  )}
                </>
              ) : (
                <span aria-hidden="true">—</span>
              )}
            </span>
            {showPop && (
              <div className="day-pop" role="presentation">
                <ul>
                  {series.map(s => (
                    <li key={s.tmdbId}>
                      <span className="pop-title">{s.title}</span>
                      {s.episodes > 1 && <span className="pop-x"> ×{s.episodes}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
