'use client';

import { useMemo } from 'react';
import { toneForGenreIds, DUOTONES, type Duotone } from '@/lib/duotone';
import { getWeekStart, getWeekNumber } from '@/hooks/useCalendar';
import type { CalendarEntry } from '@/hooks/useCalendar';

// 5-week month-context strip below the week board. ISO week numbers in the
// left rail (clickable to jump to that week). Episodes are rendered as
// 14×4 pills colored by genre tone. Today's cell wears the plum wash.

const WEEKDAY_HEADERS = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'] as const;

const TONE_LABELS: Record<Duotone, string> = {
  terra: 'drama',
  slate: 'noir',
  moss: 'natur',
  clay: 'komedi',
  plum: 'mystik',
  steel: 'sci-fi',
  olive: 'reality',
  oxblood: 'skräck',
};

interface Props {
  // Anchor date — the month strip shows the weeks straddling this date.
  anchor: Date;
  entries: readonly CalendarEntry[];
  onJumpToWeek: (weekStart: Date) => void;
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

export default function MonthStrip({ anchor, entries, onJumpToWeek }: Props) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Five weeks: anchor's week ±2.
  const weeks = useMemo(() => {
    const anchorWeekStart = getWeekStart(anchor);
    return Array.from({ length: 5 }, (_, i) => {
      const start = new Date(anchorWeekStart);
      start.setDate(start.getDate() + (i - 2) * 7);
      const days = Array.from({ length: 7 }, (_, j) => {
        const d = new Date(start);
        d.setDate(start.getDate() + j);
        return d;
      });
      return { start, days, num: getWeekNumber(start) };
    });
  }, [anchor]);

  const anchorWeekNum = getWeekNumber(anchor);
  const anchorMonth = anchor.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      const list = map.get(e.airDate) ?? [];
      list.push(e);
      map.set(e.airDate, list);
    }
    return map;
  }, [entries]);

  const todayMonth = today.getMonth();

  const usedTones = useMemo(() => {
    const set = new Set<Duotone>();
    for (const e of entries) set.add(toneForGenreIds(e.genreIds));
    return set;
  }, [entries]);

  return (
    <section className="month-strip" aria-label="Månadskontext">
      <div className="head">
        <div>
          <h3>{anchorMonth} — kontext</h3>
          <div className="sub">Klicka en vecka för att hoppa dit.</div>
        </div>
        <div className="meta">5 veckor · v{weeks[0].num}—v{weeks[weeks.length - 1].num}</div>
      </div>

      <div className="month-grid">
        <div className="h-cell spacer" />
        {WEEKDAY_HEADERS.map(d => (
          <div key={d} className="h-cell">{d}</div>
        ))}

        {weeks.map(week => {
          const isCurrent = week.num === anchorWeekNum;
          return (
            <ContextWeekRow
              key={week.num + '-' + week.start.toISOString()}
              week={week}
              isCurrent={isCurrent}
              today={today}
              todayMonth={todayMonth}
              entriesByDay={entriesByDay}
              onJump={onJumpToWeek}
            />
          );
        })}
      </div>

      <div className="legend">
        {DUOTONES.filter(t => usedTones.has(t)).map(t => (
          <div key={t} className="item">
            <span className={`sw`} style={{ background: `var(--duo-${t})` }} />
            {t} · {TONE_LABELS[t]}
          </div>
        ))}
        {usedTones.size > 0 && (
          <div className="item" style={{ marginLeft: 'auto', color: 'var(--ink-3)' }}>
            <span className="sw" style={{ background: 'var(--cal-deep)' }} />
            idag
          </div>
        )}
      </div>
    </section>
  );
}

function ContextWeekRow({
  week,
  isCurrent,
  today,
  todayMonth,
  entriesByDay,
  onJump,
}: {
  week: { start: Date; days: Date[]; num: number };
  isCurrent: boolean;
  today: Date;
  todayMonth: number;
  entriesByDay: Map<string, CalendarEntry[]>;
  onJump: (weekStart: Date) => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => onJump(week.start)}
        className={`vcell${isCurrent ? ' is-now' : ''}`}
        aria-label={`Hoppa till vecka ${week.num}`}
      >
        v{week.num}
      </button>
      {week.days.map(d => {
        const key = isoKey(d);
        const isToday = sameDay(d, today);
        const muted = d.getMonth() !== todayMonth;
        const dayEntries = entriesByDay.get(key) ?? [];
        return (
          <button
            type="button"
            key={key}
            onClick={() => onJump(week.start)}
            className={`dcell${muted ? ' muted' : ''}${isToday ? ' today' : ''}`}
            aria-label={`${d.getDate()} ${d.toLocaleDateString('sv-SE', { month: 'long' })}, ${dayEntries.length} avsnitt`}
            style={{ font: 'inherit', textAlign: 'left' }}
          >
            <div className="d">{d.getDate()}</div>
            {dayEntries.length > 0 && (
              <>
                <div className="pills">
                  {dayEntries.slice(0, 4).map((e, i) => {
                    const tone = toneForGenreIds(e.genreIds);
                    return <span key={i} className={`pill duo-${tone}`} aria-hidden="true" />;
                  })}
                </div>
                <div className="ct">
                  {dayEntries.length}
                  {dayEntries.some(e => e.isPremiere) ? ' · premiär' : ''}
                  {dayEntries.some(e => e.isFinale) ? ' · final' : ''}
                </div>
              </>
            )}
          </button>
        );
      })}
    </>
  );
}
