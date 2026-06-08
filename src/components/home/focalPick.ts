import type { CalendarEntry } from '@/hooks/useCalendar';
import { entryKey } from '@/lib/calendar/entry';

// Pick the "focal" episode for the Hem page — the one that gets the big
// hero block. Priority:
//   1. Episode airing today (TZ Europe/Stockholm, but we just use local).
//   2. Else, next upcoming episode within the next 14 days.
//   3. Else, null (page falls back to empty state).
//
// Pure function. Date-only comparison (no timestamps in `airDate`).
export function pickFocalEntry(
  entries: readonly CalendarEntry[],
  now: Date = new Date(),
): CalendarEntry | null {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(today.getDate() + 14);

  const todayKey = isoKey(today);

  // 1. Airing today
  const airingToday = entries
    .filter(e => e.airDate === todayKey)
    .sort((a, b) => a.airDate.localeCompare(b.airDate));
  if (airingToday.length > 0) return airingToday[0];

  // 2. Next upcoming (sorted ascending by airDate)
  const upcoming = entries
    .filter(e => {
      const d = new Date(e.airDate + 'T00:00:00');
      return d > today && d < horizon;
    })
    .sort((a, b) => a.airDate.localeCompare(b.airDate));
  if (upcoming.length > 0) return upcoming[0];

  return null;
}

function isoKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function focalEntryKey(e: CalendarEntry): string {
  return entryKey(e);
}

// How many days from today until the focal episode airs.
//   < 0: aired N days ago
//   0:   today
//   > 0: airs in N days
export function daysFromToday(airDate: string, now: Date = new Date()): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(airDate + 'T00:00:00');
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}
