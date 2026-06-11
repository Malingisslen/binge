import type { CalendarEntry } from './types';

// Per-kind-helpers så de många kalender-konsumenterna (WeekBoard, MonthStrip,
// EventCard, WeekStrip, HemFocal, LaterThisWeek, focalPick …) inte var och en
// för sig grenar på `kind`. En enda källa för nyckel, länk och meta-rad.

/**
 * Stabil React-nyckel + dedupe-nyckel. Avsnitt nycklas på serie+S/E, film på
 * id (ett släpp per film). Prefixen håller film- och TV-nycklar isär även om
 * en film och en serie skulle dela tmdbId.
 */
export function entryKey(e: CalendarEntry): string {
  return e.kind === 'movie' ? `m-${e.tmdbId}` : `e-${e.tmdbId}-${e.episodeCode}`;
}

/** Intern länk till titelsidan. Trailing slash matchar trailingSlash: true. */
export function entryHref(e: CalendarEntry): string {
  return `/${e.mediaType}/${e.tmdbId}/`;
}

/** Kort meta-rad: avsnittskod resp. "Digital release". */
export function entryMetaLine(e: CalendarEntry): string {
  return e.kind === 'movie' ? 'Digital release' : e.episodeCode;
}

/**
 * Badge-text för kort. `isToday` ger "ny ikväll" / "släpps i dag". Annars
 * premiär/säsongsfinal för avsnitt, eller "digital release" för film.
 * Null = ingen badge.
 */
export function entryBadge(e: CalendarEntry, isToday: boolean): string | null {
  if (e.kind === 'movie') {
    return isToday ? 'släpps i dag' : 'digital release';
  }
  if (isToday) return 'ny ikväll';
  if (e.isPremiere) return e.season === 1 ? 'premiär' : 'ny säsong';
  if (e.isFinale) return 'säsongsfinal';
  return null;
}

/** True om vi ska visa "markera sedd"-toggeln. Alla avsnitt (även i ej
 *  påbörjade serier — att bocka av E1 från kalendern är hur man börjar),
 *  aldrig filmsläpp. */
export function canMarkWatched(e: CalendarEntry): boolean {
  return e.kind === 'episode';
}
