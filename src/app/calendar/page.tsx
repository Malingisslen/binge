'use client';

import AuthGuard from '@/components/AuthGuard';
import WeeklyCalendar from '@/components/calendar/WeeklyCalendar';
import { useCalendarEntries } from '@/hooks/useCalendar';

export default function CalendarPage() {
  return <AuthGuard><CalendarContent /></AuthGuard>;
}

function CalendarContent() {
  const entries = useCalendarEntries();

  return (
    <div>
      <h1 className="text-md font-bold text-text-primary mb-3">Kalender</h1>
      <WeeklyCalendar entries={entries} />
      <p className="text-xs text-text-muted mt-2">
        Visar kommande avsnitt för serier du tittar på. Lägg till serier i din lista för att se dem här.
      </p>
    </div>
  );
}
