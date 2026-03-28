'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import WeeklyCalendar from '@/components/calendar/WeeklyCalendar';
import { useCalendarEntries, getWeekStart, type CalendarEntry } from '@/hooks/useCalendar';

export default function CalendarPage() {
  return <AuthGuard><CalendarContent /></AuthGuard>;
}

function CalendarContent() {
  const entries = useCalendarEntries();
  const [weekStart] = useState(() => getWeekStart(new Date()));
  const today = new Date().toISOString().split('T')[0];

  const newThisWeek = useMemo(() => {
    const start = weekStart.toISOString().split('T')[0];
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    const endStr = end.toISOString().split('T')[0];
    return entries.filter(e => e.airDate >= start && e.airDate <= endStr);
  }, [entries, weekStart]);

  const airedEpisodes = useMemo(() => {
    return entries.filter(e => e.airDate <= today);
  }, [entries, today]);

  return (
    <div>
      <h1 className="text-md font-bold text-text-primary mb-3">Kalender</h1>
      <WeeklyCalendar entries={entries} />

      {newThisWeek.length > 0 && (
        <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
          <div className="px-3 py-[6px] border-b border-border-light">
            <span className="text-sm font-bold text-text-secondary">Nytt denna vecka</span>
          </div>
          <div className="px-3 py-2">
            {newThisWeek.map((entry, i) => (
              <Link
                key={`${entry.tmdbId}-${entry.episodeCode}-${i}`}
                href={`/tv/${entry.tmdbId}/`}
                className="flex items-center justify-between py-[4px] border-b border-border-light last:border-b-0 no-underline text-text-primary"
              >
                <div>
                  <span className="text-base font-semibold">{entry.title}</span>
                  <span className="text-xs text-text-muted ml-2">{entry.episodeCode}</span>
                  {entry.episodeName && (
                    <span className="text-xs text-text-muted ml-1">— {entry.episodeName}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {entry.provider && (
                    <span className="text-xxs text-accent">{entry.provider}</span>
                  )}
                  <span className="text-xxs text-text-muted">{entry.airDate}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {airedEpisodes.length > 0 && (
        <UnwatchedSection episodes={airedEpisodes} />
      )}

      {entries.length === 0 && (
        <p className="text-xs text-text-muted mt-2">
          Visar avsnitt för serier du tittar på. Lägg till serier i din lista för att se dem här.
        </p>
      )}
    </div>
  );
}

function UnwatchedSection({ episodes }: { episodes: CalendarEntry[] }) {
  const showIds = Array.from(new Set(episodes.map(e => e.tmdbId)));

  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
      <div className="px-3 py-[6px] border-b border-border-light">
        <span className="text-sm font-bold text-text-secondary">Osedda avsnitt</span>
      </div>
      <div className="px-3 py-2">
        {showIds.map(showId => {
          const showEps = episodes.filter(e => e.tmdbId === showId);
          const title = showEps[0]?.title;
          return (
            <div key={showId} className="mb-2 last:mb-0">
              <Link href={`/tv/${showId}/`} className="text-base font-semibold text-text-primary no-underline hover:text-accent">
                {title}
              </Link>
              <div className="text-xs text-text-muted">
                {showEps.length} avsnitt — {showEps[0]?.episodeCode} till {showEps[showEps.length - 1]?.episodeCode}
                {showEps[0]?.provider && (
                  <span className="text-accent ml-1">{showEps[0].provider}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
