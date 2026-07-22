'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getWeekStart, getWeekNumber, useCalendarEntries, type CalendarEntry } from '@/hooks/useCalendar';
import { useWatchlist } from '@/hooks/useWatchlist';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import type { MediaType } from '@/types';

// The persistent 7-day strip that sits at the top of every page. Today wears
// the plum picker wash + 2px plum rule (semantic = "where in time the user
// currently is"). Saffran is reserved for "now / live / decisive" (CTA,
// tonight's airing episode), not for today.
//
// Per dag visar vi den högst rankade serien + ev. avsnittsantal (×N) och en
// "+M till"-hint om fler serier släpper samma dag. Klick på cellen går till
// /calendar/?day=YYYY-MM-DD där allt listas. Aggregeringen kör mot
// `useCalendarEntries()`-cachen — gratis på sidor som redan har datan.
//
// K3: WeekStrip och /calendar delar SAMMA pipeline — useCalendarEntries med
// queryKey ['tv-lite', id]/['tv-season', ...] och TMDB_STALE-konstanter — så ett
// steady-state-glapp mellan ytorna är strukturellt omöjligt. Det som såg ut
// som divergens i QA:n var partiell data under laddning: strippen renderade
// definitiva "—"/×N-värden medan säsonger fortfarande strömmade in. Därför
// gate:as cellinnehållet på hookens isLoading (samma settled-kontrakt som
// kalendersidan) och visar "…" tills datat har landat.

const DAY_LABELS = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'] as const;

interface DaySeries {
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  episodes: number;
  rating: number | null;
}

function aggregateByDay(
  entries: CalendarEntry[],
  ratingFor: (mediaType: MediaType, tmdbId: number) => number | null,
): Record<string, DaySeries[]> {
  // BIN-560 Phase 4: inner map keyed by composite doc id — entries mix TV
  // episodes and movie releases, so a movie/TV tmdbId clash must not merge.
  const byDay = new Map<string, Map<string, DaySeries>>();
  for (const e of entries) {
    let day = byDay.get(e.airDate);
    if (!day) {
      day = new Map();
      byDay.set(e.airDate, day);
    }
    const key = mediaTypeDocId(e.mediaType, e.tmdbId);
    const existing = day.get(key);
    if (existing) {
      existing.episodes += 1;
    } else {
      day.set(key, {
        mediaType: e.mediaType,
        tmdbId: e.tmdbId,
        title: e.title,
        episodes: 1,
        rating: ratingFor(e.mediaType, e.tmdbId),
      });
    }
  }
  const result: Record<string, DaySeries[]> = {};
  for (const [day, map] of byDay) {
    const series = Array.from(map.values());
    // Rating desc (null sist), tie-break på titel för stabil ordning över renders.
    series.sort((a, b) => {
      const ra = a.rating ?? -1;
      const rb = b.rating ?? -1;
      if (ra !== rb) return rb - ra;
      return a.title.localeCompare(b.title, 'sv');
    });
    result[day] = series;
  }
  return result;
}

export default function WeekStrip() {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);

  // Strippen sitter på VARJE sida och dess kalenderpipeline (N show- + N
  // säsongs-queries) tog tidigare semaforens alla 8 slots före sidans egna
  // queries. Aktivera den först efter idle (~1,5 s) — sidans innehåll vinner
  // first paint, strippen fylls strax efter. På /calendar och Hem kör sidans
  // egen useCalendarEntries() (default enabled) så datat finns ändå direkt
  // via delad cache.
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  useEffect(() => {
    const start = () => setCalendarEnabled(true);
    const ric = window.requestIdleCallback;
    if (typeof ric === 'function') {
      const id = ric.call(window, start, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(start, 1500);
    return () => window.clearTimeout(t);
  }, []);

  const { entries, isLoading } = useCalendarEntries({ enabled: calendarEnabled });
  const { getItem } = useWatchlist();
  const seriesByDay = useMemo(
    () => aggregateByDay(entries, (mt, id) => getItem(mt, id)?.rating ?? null),
    [entries, getItem],
  );

  const week = useMemo(() => {
    if (!today) return null;
    const monday = getWeekStart(today);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
    return { monday, days, weekNumber: getWeekNumber(today), year: isoWeekYear(today) };
  }, [today]);

  if (!week || !today) {
    // Pre-mount: rendera STRUKTUR med statiska dagsetiketter men placeholder
    // för dynamiska värden (vecknummer, datum). Använder Link-element istället
    // för span så att DOM-typen inte byts vid hydration — React kan
    // uppdatera href/text in-place utan att replace:a <a>-elementen. Eliminerar
    // både content-pop OCH element-type-flickern.
    return (
      <div className="topbar-week" role="navigation" aria-label="Veckonavigering" aria-hidden="true">
        <Link href="/calendar/" prefetch={false} className="vnum">
          <span className="v">&nbsp;</span>
          <span className="yr">&nbsp;</span>
        </Link>
        {DAY_LABELS.map(label => (
          <Link key={label} href="/calendar/" prefetch={false} className="day">
            <span className="lab">{label}</span>
            <span className="num">&nbsp;</span>
            <span className="count" aria-hidden="true">&nbsp;</span>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="topbar-week" role="navigation" aria-label="Veckonavigering">
      <Link href="/calendar/" className="vnum">
        <span className="v">v{week.weekNumber}</span>
        <span className="yr">{week.year}</span>
        <span className="sr-only">, vecka {week.weekNumber}</span>
      </Link>
      {week.days.map((d, i) => {
        const isToday = sameDay(d, today);
        const key = isoDateKey(d);
        const series = seriesByDay[key] ?? [];
        const top = series[0];
        const rest = series.length - 1;
        // Popovern är bara meningsfull när den tillför info utöver vad cellen
        // redan visar inline — alltså flera serier samma dag ELLER flera
        // avsnitt av samma serie. Annars duplicerar den bara titeln.
        const showPop = !isLoading && (series.length > 1 || (top != null && top.episodes > 1));
        return (
          <Link
            key={key}
            href={`/calendar/?day=${key}`}
            className={`day${isToday ? ' today' : ''}`}
          >
            <span className="lab">{DAY_LABELS[i]}</span>
            <span className="num">{d.getDate()}</span>
            <span className="count">
              {isLoading ? (
                // Säg inte "—" (= inget sänds) medan kalenderdatat laddar.
                <>
                  <span aria-hidden="true">…</span>
                  <span className="sr-only">, laddar</span>
                </>
              ) : top ? (
                <>
                  <strong>{top.title}</strong>
                  {top.episodes > 1 && (
                    <>
                      <span className="ep-x" aria-hidden="true"> ×{top.episodes}</span>
                      <span className="sr-only">, {top.episodes} avsnitt</span>
                    </>
                  )}
                  {rest > 0 && (
                    <>
                      <span className="more" aria-hidden="true"> +{rest}</span>
                      <span className="sr-only">, plus {rest} {rest === 1 ? 'serie till' : 'serier till'}</span>
                    </>
                  )}
                </>
              ) : (
                <span aria-hidden="true">—</span>
              )}
            </span>
            {showPop && (
              <div className="day-pop" role="presentation">
                <ul>
                  {series.map(s => (
                    <li key={mediaTypeDocId(s.mediaType, s.tmdbId)}>
                      <span className="pop-title">{s.title}</span>
                      {s.episodes > 1 && <span className="pop-x"> ×{s.episodes}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}

// ISO-week-year: året som ägs av veckans torsdag (samma normalisering som
// getWeekNumber). Måndagens kalenderår kan avvika vid årsskiftet — t.ex.
// måndag 30 dec 2024 tillhör v1 2025, inte 2024.
function isoWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function isoDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
