'use client';

import { useMemo } from 'react';
import { useSubscriptionAdvisor } from './useSubscriptionAdvisor';
import { useCalendarEntries, getWeekStart, getWeekNumber, type EpisodeEntry } from './useCalendar';
import { useAuth } from './useAuth';
import { getProvider } from '@/lib/tmdb/providers';
import { toIsoDate, todayIso } from '@/lib/utils';
import { weekIndexFromAnchor } from './useUpcomingShowsForAdvisor.helpers';
import type { AdvisedShow } from '@/types';

export const TIMELINE_WEEKS = 26;
const TIMELINE_DAYS = TIMELINE_WEEKS * 7;

export interface TimelineWeek {
  startIso: string;
  endIso: string;
  monthLabel: string | null;
  weekOfYear: number;
  rangeLabel: string;
}

export interface TimelineCellEntry {
  tmdbId: number;
  title: string;
  episodeCode?: string;
  airDate: string;
}

export interface TimelineCell {
  weekIndex: number;
  entries: TimelineCellEntry[];
}

export type LaneKind = 'active' | 'upcoming' | 'pause' | 'free' | 'user-paused' | 'unsubscribed';

export interface TimelineLane {
  providerId: number;
  shortName: string;
  color: string;
  kind: LaneKind;
  monthlyCost: number | null;
  followingShowCount: number;
  cells: TimelineCell[];
  cellByIndex: Map<number, TimelineCell>;
  userPause?: { pausedAtWeekIndex: number; resumeAtWeekIndex: number | null };
}

export interface TimelineResult {
  weeks: TimelineWeek[];
  subscribedLanes: TimelineLane[];
  unsubscribedLanes: TimelineLane[];
  shouldRender: boolean;
  hasAirings: boolean;
  todayWeekIndex: number;
}

function fmtDayMonth(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('sv-SE', { month: 'short' }).replace('.', '');
  return `${d.getDate()} ${month}`;
}

export function useAdvisorTimeline(): TimelineResult {
  const advisor = useSubscriptionAdvisor(TIMELINE_DAYS);
  const { entries: calendarEntries } = useCalendarEntries();
  const { user } = useAuth();

  return useMemo(() => {
    const startMonday = getWeekStart(new Date());
    const startMondayIso = toIsoDate(startMonday);
    const weeks: TimelineWeek[] = [];
    let lastMonth = -1;
    for (let i = 0; i < TIMELINE_WEEKS; i++) {
      // Kalenderdags-stride (setDate) istället för fast-ms — DST-säkert så
      // vecko-etiketterna inte glider en dag vid sommartidsbytet (BIN-105).
      const d = new Date(startMonday);
      d.setDate(d.getDate() + i * 7);
      const end = new Date(startMonday);
      end.setDate(end.getDate() + i * 7 + 6);
      const month = d.getMonth();
      const label = month !== lastMonth
        ? d.toLocaleDateString('sv-SE', { month: 'short' }).replace('.', '')
        : null;
      lastMonth = month;
      const startIso = toIsoDate(d);
      const endIso = toIsoDate(end);
      weeks.push({
        startIso,
        endIso,
        monthLabel: label,
        weekOfYear: getWeekNumber(d),
        rangeLabel: `Vecka ${getWeekNumber(d)} · ${fmtDayMonth(startIso)}–${fmtDayMonth(endIso)}`,
      });
    }

    function weekIndexFor(dateIso: string): number | null {
      // DST-säkert vecko-index — kalenderdagar, inte fasta ms (BIN-105). En
      // fast-ms-diff räknade fel när spannet korsade sommartidsbytet (sista
      // söndagen i mars), så ett avsnitt exakt 7 dagar efter ankaret hamnade i
      // vecka 0 istället för 1.
      const wi = weekIndexFromAnchor(startMondayIso, dateIso);
      if (wi < 0 || wi >= TIMELINE_WEEKS) return null;
      return wi;
    }

    const pauses = user?.providerPauses ?? {};

    // Timelinen handlar om TV-prenumerationer — bara avsnitts-entries är
    // relevanta. Filmsläpp (kind 'movie') hör inte hemma i provider-lanesen.
    const calendarByTmdb = new Map<number, EpisodeEntry[]>();
    for (const e of calendarEntries) {
      if (e.kind !== 'episode') continue;
      const list = calendarByTmdb.get(e.tmdbId) ?? [];
      list.push(e);
      calendarByTmdb.set(e.tmdbId, list);
    }

    function buildCells(shows: AdvisedShow[]): TimelineCell[] {
      const cellMap = new Map<number, TimelineCell>();
      for (const show of shows) {
        const entries = calendarByTmdb.get(show.tmdbId) ?? [];
        const touched = new Set<number>();
        for (const e of entries) {
          const wi = weekIndexFor(e.airDate);
          if (wi === null || touched.has(wi)) continue;
          touched.add(wi);
          let cell = cellMap.get(wi);
          if (!cell) { cell = { weekIndex: wi, entries: [] }; cellMap.set(wi, cell); }
          cell.entries.push({ tmdbId: show.tmdbId, title: show.title, episodeCode: e.episodeCode, airDate: e.airDate });
        }
        // Fallback: if calendar has no hit in horizon, use the show's next-air estimate.
        // Calendar only fetches the latest already-aired season, so upcoming seasons need this fallback.
        if (touched.size === 0 && show.nextAirDate) {
          const wi = weekIndexFor(show.nextAirDate);
          if (wi !== null) {
            let cell = cellMap.get(wi);
            if (!cell) { cell = { weekIndex: wi, entries: [] }; cellMap.set(wi, cell); }
            cell.entries.push({
              tmdbId: show.tmdbId,
              title: show.title,
              episodeCode: show.nextEpisodeCode ?? undefined,
              airDate: show.nextAirDate,
            });
          }
        }
      }
      return Array.from(cellMap.values()).sort((a, b) => a.weekIndex - b.weekIndex);
    }

    function makeLane(
      base: Omit<TimelineLane, 'cells' | 'cellByIndex'>,
      shows: AdvisedShow[],
    ): TimelineLane {
      const cells = buildCells(shows);
      return { ...base, cells, cellByIndex: new Map(cells.map(c => [c.weekIndex, c])) };
    }

    const subscribedLanes: TimelineLane[] = advisor.providers.map(p => {
      const userPause = pauses[p.providerId];
      const kind: LaneKind = userPause
        ? 'user-paused'
        : p.status === 'pause' ? 'pause'
        : p.status === 'free' ? 'free'
        : p.status === 'upcoming' ? 'upcoming'
        : 'active';
      return makeLane({
        providerId: p.providerId,
        shortName: p.shortName,
        color: p.color,
        kind,
        monthlyCost: p.monthlyCost,
        followingShowCount: p.shows.length,
        userPause: userPause ? {
          pausedAtWeekIndex: weekIndexFor(userPause.pausedAt) ?? 0,
          resumeAtWeekIndex: userPause.resumeAt ? weekIndexFor(userPause.resumeAt) : null,
        } : undefined,
      }, p.shows);
    });

    const unsubscribedLanes: TimelineLane[] = advisor.subscribeAdvice.map(sa => {
      const provider = getProvider(sa.providerId);
      return makeLane({
        providerId: sa.providerId,
        shortName: sa.shortName,
        color: sa.color,
        kind: 'unsubscribed',
        monthlyCost: provider?.defaultMonthlyCost ?? null,
        followingShowCount: sa.shows.length,
      }, sa.shows);
    });

    const totalAirings = [...subscribedLanes, ...unsubscribedLanes]
      .reduce((sum, lane) => sum + lane.cells.reduce((s, c) => s + c.entries.length, 0), 0);
    const laneCount = subscribedLanes.length + unsubscribedLanes.length;
    const shouldRender = laneCount >= 1;
    const hasAirings = totalAirings >= 1;
    const todayWeekIndex = weekIndexFor(todayIso()) ?? 0;

    return { weeks, subscribedLanes, unsubscribedLanes, shouldRender, hasAirings, todayWeekIndex };
  }, [advisor, calendarEntries, user?.providerPauses]);
}
