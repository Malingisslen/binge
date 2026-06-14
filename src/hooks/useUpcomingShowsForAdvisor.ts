'use client';

import { useMemo } from 'react';
import { useSubscriptionAdvisor } from './useSubscriptionAdvisor';
import { useCalendarEntries, getWeekStart } from './useCalendar';
import { useAuth } from './useAuth';
import { todayIso } from '@/lib/utils';

// Per-serie-vy av kommande avsnitt för Streamingrådgivaren.
//
// Tidigare version gick via useAdvisorTimeline — men den hooken är byggd
// för en vecko-grid och dedupar entries per (show, week). En serie som
// släpper avsnitt onsdag + torsdag samma vecka tappade alltså 50% av
// pillsen i V1-listan. Den här hooken läser calendar-entries direkt så
// varje avsnitt får sin egen pill, oavsett hur tätt de ligger.

export interface UpcomingEpisode {
  airDate: string;          // YYYY-MM-DD
  episodeCode?: string;     // "S2E03"
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
  // Antal sammanhängande lugna veckor i slutet av fönstret. Används för
  // pause-rekommendationen som visas under listan.
  trailingQuietWeeks: number;
  isLoading: boolean;
}

const DEFAULT_WEEKS = 8;
const DAY_MS = 86400000;

export function useUpcomingShowsForAdvisor(weeks: number = DEFAULT_WEEKS): UpcomingShowsResult {
  // useSubscriptionAdvisor's lookAheadDays påverkar bara status-bedömningar
  // — providers-listan + show-attribution är samma. Default 60 räcker.
  const advisor = useSubscriptionAdvisor();
  const { entries: calendarEntries, isLoading: calLoading } = useCalendarEntries();
  const { user } = useAuth();

  return useMemo(() => {
    const today = todayIso();
    const startMonday = getWeekStart(new Date());
    const startMs = startMonday.getTime();
    const horizonMs = startMs + weeks * 7 * DAY_MS;
    const userPaused = new Set(Object.keys(user?.providerPauses ?? {}).map(Number));

    function weekIndexFor(dateIso: string): number {
      const ms = new Date(dateIso + 'T00:00:00').getTime();
      return Math.floor((ms - startMs) / (7 * DAY_MS));
    }

    // Bygg show → provider-attribution. En serie som finns hos flera providers
    // hamnar på första (non-paused) subscribed-provider vi ser. Det är
    // sannolikt fel ibland (borde vara den provider med bäst valuta för
    // användaren) men låt det vara en uppföljning.
    const showProviderMap = new Map<number, {
      providerId: number;
      providerShortName: string;
      providerColor: string;
    }>();
    for (const p of advisor.providers) {
      if (userPaused.has(p.providerId)) continue;
      for (const show of p.shows) {
        if (!showProviderMap.has(show.tmdbId)) {
          showProviderMap.set(show.tmdbId, {
            providerId: p.providerId,
            providerShortName: p.shortName,
            providerColor: p.color,
          });
        }
      }
    }

    // Per-avsnitt iteration: läs ALLA calendar entries och plocka in dem
    // som faller inom horizonten OCH ligger på en subscribed provider.
    const showMap = new Map<number, UpcomingShow>();
    for (const e of calendarEntries) {
      // Rådgivaren handlar om TV-avsnitt på prenumerationer — filmsläpp hör inte hit.
      if (e.kind !== 'episode') continue;
      if (e.airDate < today) continue;
      const ms = new Date(e.airDate + 'T00:00:00').getTime();
      if (ms >= horizonMs) continue;
      const meta = showProviderMap.get(e.tmdbId);
      if (!meta) continue;

      const wi = weekIndexFor(e.airDate);
      if (wi < 0 || wi >= weeks) continue;

      const episode: UpcomingEpisode = {
        airDate: e.airDate,
        episodeCode: e.episodeCode,
        weekIndex: wi,
        isFinale: e.isFinale === true,
        isToday: e.airDate === today,
      };

      const existing = showMap.get(e.tmdbId);
      if (existing) {
        // Dedupa på episod-IDENTITET, inte datum (BIN-12): två avsnitt samma
        // dag (double-premiere S1E01+S1E02, batch-drop) ska båda räknas — en
        // air-date-only-guard tappade det andra + underräknade totalEpisodes.
        // Kalender-entries är redan deduppade uppströms på tmdbId-S{n}E{n}.
        if (!existing.episodes.some(ep => ep.episodeCode === e.episodeCode)) {
          existing.episodes.push(episode);
        }
      } else {
        showMap.set(e.tmdbId, {
          tmdbId: e.tmdbId,
          title: e.title,
          providerId: meta.providerId,
          providerShortName: meta.providerShortName,
          providerColor: meta.providerColor,
          episodes: [episode],
          firstAirDate: e.airDate,
        });
      }
    }

    // Fallback: serier utan calendar entries men med en känd nextAirDate
    // (typiskt en ny säsong som annonserats i TMDB men ännu inte börjat) får
    // en enstaka pill så användaren ser att den är "på väg".
    for (const p of advisor.providers) {
      if (userPaused.has(p.providerId)) continue;
      for (const show of p.shows) {
        if (showMap.has(show.tmdbId)) continue;
        if (!show.nextAirDate) continue;
        if (show.nextAirDate < today) continue;
        const ms = new Date(show.nextAirDate + 'T00:00:00').getTime();
        if (ms >= horizonMs) continue;
        const wi = weekIndexFor(show.nextAirDate);
        if (wi < 0 || wi >= weeks) continue;

        showMap.set(show.tmdbId, {
          tmdbId: show.tmdbId,
          title: show.title,
          providerId: p.providerId,
          providerShortName: p.shortName,
          providerColor: p.color,
          episodes: [{
            airDate: show.nextAirDate,
            episodeCode: show.nextEpisodeCode ?? undefined,
            weekIndex: wi,
            isFinale: false,
            isToday: show.nextAirDate === today,
          }],
          firstAirDate: show.nextAirDate,
        });
      }
    }

    showMap.forEach(s => {
      s.episodes.sort((a, b) => a.airDate.localeCompare(b.airDate));
      s.firstAirDate = s.episodes[0]?.airDate ?? s.firstAirDate;
    });

    // Sortera: flest avsnitt först (= aktivast), sedan tidigast first-air
    // som tiebreaker så ordningen är deterministisk.
    const shows = Array.from(showMap.values()).sort((a, b) => {
      if (b.episodes.length !== a.episodes.length) return b.episodes.length - a.episodes.length;
      return a.firstAirDate.localeCompare(b.firstAirDate);
    });

    const totalEpisodes = shows.reduce((sum, s) => sum + s.episodes.length, 0);

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
      // Vänta på BÅDE kalendern och rådgivaren. Kalendern kan lösas från cache
      // (calLoading=false) medan rådgivaren fortfarande hämtar watchlist + TMDB
      // (advisor.isLoading=true, providers=[]) → annars returneras ett falskt
      // "inget på gång" som poppar in den riktiga listan när rådgivaren landar.
      isLoading: calLoading || advisor.isLoading,
    };
  }, [advisor.providers, advisor.isLoading, calendarEntries, weeks, calLoading, user?.providerPauses]);
}
