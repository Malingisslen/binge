'use client';

import { useMemo } from 'react';
import { useCalendarEntries } from './useCalendar';
import { useWatchlist } from './useWatchlist';
import { countEntries, type CalendarCounts } from '@/lib/calendar/summary';
import {
  quarterWindow,
  coveredTmdbIdsInWindow,
  derivePremierePills,
  selectQuarterEvents,
  groupEntriesByMonth,
  type PremiereWindow,
  type MonthGroup,
} from '@/lib/calendar/premieres';
import type { CalendarEntry } from '@/lib/calendar/types';

// Kvartalsvyns datakälla. Tunn komposition ovanpå useCalendarEntries (återanvänds
// ORÖRT — read-repair-effekten bor kvar på sin enda callsite där inne) plus de
// rena helprarna i @/lib/calendar/premieres. All logik är testad där; den här
// hooken är bara limmet.
export interface PremiereEventsResult {
  window: PremiereWindow;
  events: CalendarEntry[];
  groups: MonthGroup[];
  counts: CalendarCounts;
  isLoading: boolean;
}

export function usePremiereEvents(): PremiereEventsResult {
  const { entries, isLoading } = useCalendarEntries();
  const { items } = useWatchlist();

  return useMemo(() => {
    const window = quarterWindow();
    const covered = coveredTmdbIdsInWindow(entries, window);
    const pills = derivePremierePills(items, covered, window);
    const events = selectQuarterEvents([...entries, ...pills], window);
    const groups = groupEntriesByMonth(events);
    return { window, events, groups, counts: countEntries(events), isLoading };
  }, [entries, items, isLoading]);
}
