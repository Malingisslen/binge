'use client';

import { useMemo, useState } from 'react';
import AuthGuard from '@/components/AuthGuard';
import WeekBoard from '@/components/calendar/WeekBoard';
import MonthStrip from '@/components/calendar/MonthStrip';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { LoadingView } from '@/components/ui/LoadingView';
import { useCalendarEntries, getWeekStart, getWeekNumber } from '@/hooks/useCalendar';
import { countEntries } from '@/lib/calendar/summary';
import { buildCalendarHeadline, buildCalendarStandfirst } from '@/lib/calendar/copy';

export default function CalendarPage() {
  return <AuthGuard><CalendarContent /></AuthGuard>;
}

function CalendarContent() {
  const { entries, isLoading } = useCalendarEntries();
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const weekNum = getWeekNumber(weekStart);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const todayWeekStart = useMemo(() => getWeekStart(today), [today]);
  const isCurrentWeek = weekStart.getTime() === todayWeekStart.getTime();

  // Standfirst: count this week's episodes for an honest "denna vecka — N
  // avsnitt" line. Direction H header pattern: crumb → h1 → standfirst.
  const weekEntries = useMemo(() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 7);
    const startKey = isoKey(weekStart);
    const endKey = isoKey(end);
    return entries.filter(e => e.airDate >= startKey && e.airDate < endKey);
  }, [entries, weekStart]);

  const counts = countEntries(weekEntries);

  const prevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };
  const nextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };
  const goToday = () => setWeekStart(todayWeekStart);

  // Rubrik + undertext via @/lib/calendar/copy — disjunkt, TDD:ad aritmetik
  // (K2): premiärer är en delmängd av avsnitten och uttrycks med "varav".
  const standfirst = buildCalendarStandfirst(counts, isCurrentWeek);
  const headline = buildCalendarHeadline(counts);

  // K1-gaten: rubrikräkning, dagceller och kort härleds ur samma entries-
  // array — rendera inget av dem förrän hela show/säsong/film-vattenfallet
  // är avgjort. Annars visas definitiva räknetal ("2 avsnitt") medan fler
  // avsnitt fortfarande strömmar in säsong för säsong.
  if (isLoading) {
    return (
      <>
        <header>
          <div className="crumb">
            Kalender · v{weekNum} · {formatRange(weekStart)}
          </div>
          <h1 className="page-h1">Kalender</h1>
        </header>
        <LoadingView label="Hämtar din vecka…" variant="detail" />
      </>
    );
  }

  return (
    <>
      <header>
        <div className="crumb">
          Kalender · v{weekNum} · {formatRange(weekStart)}
        </div>
        <h1 className="page-h1">{headline}</h1>
        <p className="stand">{standfirst}</p>
      </header>

      <div className="kal-actions">
        <div className="nav-week">
          <button onClick={prevWeek} aria-label={`Föregående vecka, v${weekNum - 1}`}>
            ← v{weekNum - 1}
          </button>
          <button
            onClick={goToday}
            className={isCurrentWeek ? 'is-on' : undefined}
            aria-current={isCurrentWeek ? 'date' : undefined}
          >
            v{weekNum}{isCurrentWeek ? ' · idag' : ''}
          </button>
          <button onClick={nextWeek} aria-label={`Nästa vecka, v${weekNum + 1}`}>
            v{weekNum + 1} →
          </button>
        </div>
        {!isCurrentWeek && (
          <button onClick={goToday} className="btn btn-ghost btn-sm">
            Hoppa till idag
          </button>
        )}
      </div>

      <WeekBoard weekStart={weekStart} entries={weekEntries} />

      {entries.length > 0 && (
        <MonthStrip anchor={weekStart} entries={entries} onJumpToWeek={setWeekStart} />
      )}

      {entries.length === 0 && (
        <p className="stand" style={{ marginTop: 24 }}>
          Visar avsnitt för serier du tittar på eller vill se, och digitala
          filmsläpp för filmer du vill se. Lägg till några titlar i din lista
          för att se dem här.
        </p>
      )}

      {entries.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <JustWatchCredit />
        </div>
      )}
    </>
  );
}

function formatRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const startDay = weekStart.getDate();
  const endDay = end.getDate();
  const monthFmt = new Intl.DateTimeFormat('sv-SE', { month: 'long' });
  const startMonth = monthFmt.format(weekStart);
  const endMonth = monthFmt.format(end);
  if (startMonth === endMonth) {
    return `${startDay}–${endDay} ${startMonth}`;
  }
  return `${startDay} ${startMonth} – ${endDay} ${endMonth}`;
}

function isoKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
