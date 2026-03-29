'use client';

import { useState, useMemo } from 'react';
import { getMonthDays, formatWeekday, type CalendarEntry } from '@/hooks/useCalendar';
import CalendarEntryItem from './CalendarEntryItem';

const MONTH_NAMES = [
  'januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december',
];

const WEEKDAY_HEADERS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

interface MonthlyCalendarProps {
  entries?: CalendarEntry[];
}

export default function MonthlyCalendar({ entries = [] }: MonthlyCalendarProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const days = useMemo(() => getMonthDays(year, month), [year, month]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    entries.forEach(e => {
      if (!map.has(e.airDate)) map.set(e.airDate, []);
      map.get(e.airDate)!.push(e);
    });
    return map;
  }, [entries]);

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
      <div className="flex items-center justify-between px-3 py-[6px] border-b border-border-light text-sm">
        <span className="font-bold text-text-secondary">
          {MONTH_NAMES[month]} {year}
        </span>
        <span className="text-text-muted cursor-pointer text-base">
          <a onClick={prevMonth} className="text-text-muted no-underline mx-[6px] hover:text-accent cursor-pointer">←</a>
          <a onClick={nextMonth} className="text-text-muted no-underline mx-[6px] hover:text-accent cursor-pointer">→</a>
        </span>
      </div>

      {/* Desktop grid */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7">
          {WEEKDAY_HEADERS.map((d, i) => (
            <div key={i} className={`text-xxs uppercase tracking-[0.5px] text-text-muted px-[6px] py-1 text-center bg-cal-header border-b border-border-light font-semibold ${
              i < 6 ? 'border-r border-r-border-light' : ''
            }`}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const isCurrentMonth = day.getMonth() === month;
            const isToday = day.getTime() === today.getTime();
            const dateStr = day.toISOString().split('T')[0];
            const dayEntries = entriesByDate.get(dateStr) ?? [];

            return (
              <div
                key={i}
                className={`min-h-[48px] px-[4px] py-[2px] text-xs border-b border-border-light ${
                  i % 7 < 6 ? 'border-r border-r-border-light' : ''
                } ${isCurrentMonth ? '' : 'opacity-30'}`}
              >
                <div className={`text-xxs mb-[1px] ${isToday ? 'text-accent font-bold' : 'text-text-muted'}`}>
                  {day.getDate()}
                </div>
                {dayEntries.map((entry, j) => (
                  <div key={j} className="text-xxs leading-tight mb-[1px]">
                    <span className="text-text-primary font-semibold">{entry.episodeCode}</span>
                    <span className="text-text-muted ml-[2px]">{entry.title}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: list of days with entries */}
      <div className="md:hidden">
        {days.filter(day => {
          const dateStr = day.toISOString().split('T')[0];
          return day.getMonth() === month && (entriesByDate.get(dateStr)?.length ?? 0) > 0;
        }).map((day, i) => {
          const isToday = day.getTime() === today.getTime();
          const dateStr = day.toISOString().split('T')[0];
          const dayEntries = entriesByDate.get(dateStr) ?? [];

          return (
            <div key={i} className="flex border-b border-border-light last:border-b-0">
              <div className={`w-[60px] shrink-0 px-2 py-[6px] text-xxs uppercase font-semibold bg-cal-header ${
                isToday ? 'text-accent font-bold' : 'text-text-muted'
              }`}>
                {day.getDate()} {formatWeekday(day)}
              </div>
              <div className="flex-1 px-2 py-[6px] text-xs text-text-muted min-h-[32px]">
                {dayEntries.map((entry, j) => (
                  <CalendarEntryItem key={j} entry={entry} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
