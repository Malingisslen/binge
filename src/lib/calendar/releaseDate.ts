import type { TMDBMovie } from '@/types';

// TMDB release-type-koder (per land), från /movie/{id}/release_dates:
//   1 Premiere · 2 Theatrical (limited) · 3 Theatrical · 4 Digital · 5 Physical · 6 TV
export const RELEASE_TYPE_DIGITAL = 4;

/**
 * Plockar svenskt digitalt släppdatum (yyyy-mm-dd) ur en films release_dates.
 *
 * Vi vill bara ha SE + type 4 (Digital) — det relevanta för en streaming-
 * tracker. Finns flera digitala datum (t.ex. olika plattformar) väljer vi det
 * tidigaste. Saknas SE-digitaldatum returneras null och filmen tas inte med i
 * kalendern.
 *
 * Ren funktion — testbar utan Firebase/TMDB-fetch.
 */
export function pickSwedishDigitalRelease(movie: TMDBMovie): string | null {
  const se = movie.release_dates?.results?.find(r => r.iso_3166_1 === 'SE');
  if (!se) return null;

  const digitalDates = se.release_dates
    .filter(d => d.type === RELEASE_TYPE_DIGITAL && d.release_date)
    // TMDB ger ISO-8601 med tid+zon (t.ex. 2026-06-12T00:00:00.000Z). Vi bryr
    // oss bara om kalenderdagen → klipp till yyyy-mm-dd.
    .map(d => d.release_date.slice(0, 10))
    .sort();

  return digitalDates[0] ?? null;
}

// BIN-193 — cinema→streaming countdown.
export const RELEASE_TYPE_THEATRICAL_LIMITED = 2;
export const RELEASE_TYPE_THEATRICAL = 3;

/**
 * Earliest Swedish theatrical (or limited-theatrical) release date (yyyy-mm-dd),
 * or null. "Has this opened in Swedish cinemas?" Pure.
 */
export function pickSwedishTheatricalRelease(movie: TMDBMovie): string | null {
  const se = movie.release_dates?.results?.find(r => r.iso_3166_1 === 'SE');
  if (!se) return null;
  const dates = se.release_dates
    .filter(d => (d.type === RELEASE_TYPE_THEATRICAL || d.type === RELEASE_TYPE_THEATRICAL_LIMITED) && d.release_date)
    .map(d => d.release_date.slice(0, 10))
    .sort();
  return dates[0] ?? null;
}

export interface CinemaToStreaming {
  digitalDate: string; // yyyy-mm-dd, in the future
  daysUntil: number;   // whole days from today to the digital release (>= 1)
}

/**
 * "På bio nu → streamas [datum]": true when the film has opened in Swedish
 * cinemas (a theatrical date today or earlier) AND has a known *future* Swedish
 * digital date. Returns null otherwise (not in cinemas yet, or already
 * streaming, or no dates). Pure — pass todayIso as yyyy-mm-dd so it's testable.
 */
export function cinemaToStreaming(movie: TMDBMovie, todayIso: string): CinemaToStreaming | null {
  const theatrical = pickSwedishTheatricalRelease(movie);
  const digital = pickSwedishDigitalRelease(movie);
  if (!theatrical || !digital) return null;
  if (theatrical > todayIso) return null; // not in cinemas yet
  if (digital <= todayIso) return null;   // already streaming (or releases today)
  const from = Date.parse(`${todayIso}T00:00:00Z`);
  const to = Date.parse(`${digital}T00:00:00Z`);
  return { digitalDate: digital, daysUntil: Math.round((to - from) / 86_400_000) };
}
