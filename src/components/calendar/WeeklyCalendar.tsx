'use client';

import { useState, useMemo } from 'react';
import { getWeekStart, formatWeekday, getWeekNumber, type CalendarEntry } from '@/hooks/useCalendar';

interface WeeklyCalendarProps {
  entries?: CalendarEntry[];
}

export default function WeeklyCalendar({ entries = [] }: WeeklyCalendarProps) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));

  const days = useMemo(() => {
    const result: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      result.push(d);
    }
    return result;
  }, [weekStart]);

  const weekNum = getWeekNumber(weekStart);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

  const entriesByDate = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    entries.forEach(e => {
      const key = e.airDate;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    });
    return map;
  }, [entries]);

  const lastDay = days[days.length - 1];
  const rangeStr = `${days[0].getDate()}–${lastDay.getDate()} ${lastDay.toLocaleDateString('sv-SE', { month: 'long' })}`;

  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
      <div className="flex items-center justify-between px-3 py-[6px] border-b border-border-light text-sm">
        <span className="font-bold text-text-secondary">Vecka {weekNum} — {rangeStr}</span>
        <span className="text-text-muted cursor-pointer text-base">
          <a onClick={prevWeek} className="text-text-muted no-underline mx-[6px] hover:text-accent cursor-pointer">
            ← v{weekNum - 1}
          </a>
          <a onClick={nextWeek} className="text-text-muted no-underline mx-[6px] hover:text-accent cursor-pointer">
            v{weekNum + 1} →
          </a>
        </span>
      </div>
      {/* Desktop: 7-col grid */}
      <div className="hidden md:grid grid-cols-7">
        {days.map((day, i) => {
          const isToday = day.getTime() === today.getTime();
          return (
            <div
              key={i}
              className={`text-xxs uppercase tracking-[0.5px] text-text-muted px-[6px] py-1 text-center bg-cal-header border-b border-border-light font-semibold ${
                i < 6 ? 'border-r border-r-border-light' : ''
              } ${isToday ? '!text-accent !font-bold' : ''}`}
            >
              {formatWeekday(day)} {day.getDate()}
            </div>
          );
        })}
      </div>
      <div className="hidden md:grid grid-cols-7">
        {days.map((day, i) => {
          const dateStr = day.toISOString().split('T')[0];
          const dayEntries = entriesByDate.get(dateStr) ?? [];

          return (
            <div
              key={i}
              className={`min-h-[52px] px-[5px] py-1 text-xs text-text-muted ${
                i < 6 ? 'border-r border-r-border-light' : ''
              }`}
            >
              {dayEntries.length === 0 ? (
                <span>—</span>
              ) : (
                dayEntries.map((entry, j) => (
                  <div key={j} className="mb-1">
                    <div className="text-text-primary font-semibold text-xs leading-tight">{entry.title}</div>
                    <div className="text-text-muted text-xxs">{entry.episodeCode}</div>
                    {entry.provider && <div className="text-accent text-xxs">{entry.provider}</div>}
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: vertical list */}
      <div className="md:hidden">
        {days.map((day, i) => {
          const isToday = day.getTime() === today.getTime();
          const dateStr = day.toISOString().split('T')[0];
          const dayEntries = entriesByDate.get(dateStr) ?? [];

          return (
            <div key={i} className="flex border-b border-border-light last:border-b-0">
              <div className={`w-[60px] shrink-0 px-2 py-[6px] text-xxs uppercase font-semibold bg-cal-header ${
                isToday ? 'text-accent font-bold' : 'text-text-muted'
              }`}>
                {formatWeekday(day)} {day.getDate()}
              </div>
              <div className="flex-1 px-2 py-[6px] text-xs text-text-muted min-h-[32px]">
                {dayEntries.length === 0 ? (
                  <span>—</span>
                ) : (
                  dayEntries.map((entry, j) => (
                    <div key={j} className="mb-1">
                      <span className="text-text-primary font-semibold">{entry.title}</span>
                      {' '}<span className="text-text-muted text-xxs">{entry.episodeCode}</span>
                      {entry.provider && <span className="text-accent text-xxs ml-1">{entry.provider}</span>}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
