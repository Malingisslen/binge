'use client';

import { useMemo, useState } from 'react';
import AuthGuard from '@/components/AuthGuard';
import WeekBoard from '@/components/calendar/WeekBoard';
import MonthStrip from '@/components/calendar/MonthStrip';
import { useCalendarEntries, getWeekStart, getWeekNumber } from '@/hooks/useCalendar';

export default function CalendarPage() {
  return <AuthGuard><CalendarContent /></AuthGuard>;
}

function CalendarContent() {
  const entries = useCalendarEntries();
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

  const premiereCount = weekEntries.filter(e => e.isPremiere).length;
  const finaleCount = weekEntries.filter(e => e.isFinale).length;

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

  // Standfirst copy varies on whether this is the current week and what's
  // notable in it (premiärer, finaler, eller bara avsnitt).
  const standfirst = buildStandfirst(weekEntries.length, premiereCount, finaleCount, isCurrentWeek);

  return (
    <>
      <header>
        <div className="crumb">
          Kalender · v{weekNum} · {formatRange(weekStart)}
        </div>
        <h1 className="page-h1">
          {weekEntries.length === 0
            ? 'En lugn vecka.'
            : `Denna vecka — ${weekEntries.length} ${weekEntries.length === 1 ? 'avsnitt' : 'avsnitt'}${premiereCount > 0 ? ` och ${premiereCount} premiär${premiereCount === 1 ? '' : 'er'}` : ''}.`}
        </h1>
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
          Visar avsnitt för serier du tittar på. Lägg till några serier i din lista för att se dem här.
        </p>
      )}
    </>
  );
}

function buildStandfirst(
  total: number,
  premieres: number,
  finales: number,
  isCurrent: boolean,
): string {
  if (total === 0) {
    return isCurrent
      ? 'Inget på schemat denna vecka. Bra läge för att hitta något nytt.'
      : 'Inget på schemat den här veckan.';
  }
  const parts: string[] = [];
  if (premieres > 0) parts.push(`${premieres} premiär${premieres === 1 ? '' : 'er'}`);
  if (finales > 0) parts.push(`${finales} säsongsfinal${finales === 1 ? '' : 'er'}`);
  if (parts.length === 0) {
    return isCurrent
      ? 'Allt på schemat ligger nedanför. Markera avsnitten du har sett när du är klar.'
      : 'Veckans avsnitt nedan.';
  }
  return `Inräknat ${parts.join(' och ')}. Markera avsnitten du har sett när du är klar.`;
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
