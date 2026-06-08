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
