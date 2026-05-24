'use client';

import { useMemo } from 'react';
import { useAdvisorTimeline } from './useAdvisorTimeline';
import { useCalendarEntries } from './useCalendar';
import { todayIso } from '@/lib/utils';

// Per-serie-vy av kommande avsnitt för Streamingrådgivaren.
// Återanvänder data från useAdvisorTimeline (som i sin tur återanvänder
// useSubscriptionAdvisor) — vi gör inga egna TMDB-fetches här.

export interface UpcomingEpisode {
  airDate: string;          // YYYY-MM-DD
  episodeCode?: string;     // "S2E03" om TMDB-data finns
  weekIndex: number;        // 0..weeks-1
  isFinale: boolean;
  isToday: boolean;
}

export interface UpcomingShow {
  tmdbId: number;
  title: string;
  providerId: number;
  providerShortName: string;
  providerColor: string;
  episodes: UpcomingEpisode[];   // sorterad efter airDate stigande
  firstAirDate: string;
}

export interface UpcomingShowsResult {
  shows: UpcomingShow[];
  totalEpisodes: number;
  weeks: number;
  // Antal sammanhängande lugna veckor i slutet av fönstret. Används för att
  // visa "X lugna veckor framöver" som pause-rekommendation under listan.
  trailingQuietWeeks: number;
  isLoading: boolean;
}

const DEFAULT_WEEKS = 8;

export function useUpcomingShowsForAdvisor(weeks: number = DEFAULT_WEEKS): UpcomingShowsResult {
  const timeline = useAdvisorTimeline();
  const { entries: calendarEntries, isLoading: calLoading } = useCalendarEntries();

  return useMemo(() => {
    const today = todayIso();

    // CalendarEntry har isFinale per avsnitt — bygg lookup per
    // tmdbId+airDate så timeline-entries kan berikas. Timeline-datan har
    // bara title + episodeCode + airDate utan finale-flagga.
    const finaleSet = new Set<string>();
    for (const e of calendarEntries) {
      if (e.isFinale) finaleSet.add(`${e.tmdbId}|${e.airDate}`);
    }

    // Dedupe per tmdbId — en serie tillhör flera providers ibland.
    // Första subscribed-lane som har serien får attribution. Det är
    // sannolikt fel ibland (vi borde välja den lane med bäst valuta för
    // användaren) men låt det vara en uppföljning.
    const showMap = new Map<number, UpcomingShow>();

    for (const lane of timeline.subscribedLanes) {
      // Skippa user-paused: vi ska inte trycka avsnitt på en tjänst som
      // användaren aktivt sagt upp.
      if (lane.kind === 'user-paused') continue;

      for (const cell of lane.cells) {
        if (cell.weekIndex >= weeks) continue;
        for (const entry of cell.entries) {
          const existing = showMap.get(entry.tmdbId);
          const isFinale = finaleSet.has(`${entry.tmdbId}|${entry.airDate}`);
          const episode: UpcomingEpisode = {
            airDate: entry.airDate,
            episodeCode: entry.episodeCode,
            weekIndex: cell.weekIndex,
            isFinale,
            isToday: entry.airDate === today,
          };
          if (existing) {
            // Lägg bara till om vi inte redan har samma airDate (kan hända
            // om calendar och advisor-fallback råkar peka på samma datum).
            if (!existing.episodes.some(e => e.airDate === entry.airDate)) {
              existing.episodes.push(episode);
            }
          } else {
            showMap.set(entry.tmdbId, {
              tmdbId: entry.tmdbId,
              title: entry.title,
              providerId: lane.providerId,
              providerShortName: lane.shortName,
              providerColor: lane.color,
              episodes: [episode],
              firstAirDate: entry.airDate,
            });
          }
        }
      }
    }

    // Sortera avsnitt per serie + uppdatera firstAirDate.
    showMap.forEach(s => {
      s.episodes.sort((a, b) => a.airDate.localeCompare(b.airDate));
      s.firstAirDate = s.episodes[0]?.airDate ?? s.firstAirDate;
    });

    // Sortera serier: flest avsnitt först (= aktivast just nu), sedan
    // tidigast first-air-date som tiebreaker så ordningen är stabil.
    const shows = Array.from(showMap.values()).sort((a, b) => {
      if (b.episodes.length !== a.episodes.length) return b.episodes.length - a.episodes.length;
      return a.firstAirDate.localeCompare(b.firstAirDate);
    });

    const totalEpisodes = shows.reduce((sum, s) => sum + s.episodes.length, 0);

    // Räkna efterhängande lugna veckor — bara om vi har minst en serie att
    // visa (annars är hela perioden lugn vilket inte är "pause-värt").
    const weekHasEpisode = new Array(weeks).fill(false);
    for (const s of shows) {
      for (const e of s.episodes) {
        if (e.weekIndex >= 0 && e.weekIndex < weeks) {
          weekHasEpisode[e.weekIndex] = true;
        }
      }
    }
    let trailingQuietWeeks = 0;
    if (shows.length > 0) {
      for (let i = weeks - 1; i >= 0; i--) {
        if (weekHasEpisode[i]) break;
        trailingQuietWeeks++;
      }
    }

    return {
      shows,
      totalEpisodes,
      weeks,
      trailingQuietWeeks,
      isLoading: calLoading,
    };
  }, [timeline.subscribedLanes, calendarEntries, weeks, calLoading]);
}
