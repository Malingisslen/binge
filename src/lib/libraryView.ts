// Pure helpers för biblioteksvyerna (WatchlistPage + watchlist/*).
// Extraherade hit så de kan testas utan Firebase/React Query-imports.

import { isEndedStatus } from '@/lib/airingState';
import { pluralSv } from '@/lib/utils';
import { genreLabel } from '@/lib/tmdb/genreLabels';
import type { WatchStatus, WatchlistItem } from '@/types';

// === Substate för /my/series — persisted-fields-only (B7/T2/B2) ===
//
// KONTRAKT: härleds ENBART från persisterade watchlist-fält
// (lastWatchedSeason/lastWatchedEpisode, totalSeasons, tmdbStatus — de två
// senare lazy-uppdaterade via updateTmdbStatus när titelsidan besöks) plus en
// valfri `knownBehind`-flagga från en datakälla som redan finns på sidan
// (Streamingrådgivarens behind-set, byggt på riktig last_episode_to_air-data).
// INGEN TMDB-fan-out per titel — 194 serier får inte bli 194 queries.
//
// Vad vi PÅSTÅR vs INTE påstår:
//  - 'ej_paborjad'  — säkert: ingen progress sparad.
//  - 'ligger_efter' — påstås BARA när det är säkert: (a) knownBehind från
//    riktig aired-data, eller (b) serien är Ended/Canceled (allt har sänts)
//    och användaren ligger bakom sista kända säsongen.
//  - 'avslutad'     — Ended/Canceled + progress inne i sista kända säsongen.
//    Approximation: vi sparar inte avsnitt-per-säsong, så "inne i sista
//    säsongen" ≈ "klar". Accepterad felmarginal.
//  - 'paborjad'     — ärligt obestämt: påbörjad, men utan aired-data går det
//    inte att skilja "ikapp" från "ligger efter" (för Returning Series kan
//    totalSeasons dessutom inkludera en annonserad men ännu inte sänd säsong).
//    Vi påstår därför INGETDERA — kortet visar bara vad vi vet ("S2E10 sedd").
//
// Skillnad mot tvSubState (watchStatus.ts): den kräver TMDBTVShow-data och
// används där sådan redan finns (titelsidor). Biblioteket använder denna.
export type LibrarySubState = 'ligger_efter' | 'paborjad' | 'ej_paborjad' | 'avslutad';

// `knownBehind` och `knownEndedCaughtUp` är ömsesidigt uteslutande live-signaler
// från Streamingrådgivarens redan hämtade TMDB-data (samma som behind-settet —
// INGEN extra fan-out): en serie är antingen bakom på aireade avsnitt
// (knownBehind) eller ikapp. `knownEndedCaughtUp` = ikapp PÅ en Ended/Canceled
// show → 'avslutad'. Detta fångar fallet där tmdbStatus/totalSeasons aldrig
// lazy-backfillats men rådgivaren ändå vet att showen är slut.
export function librarySubState(
  item: WatchlistItem,
  knownBehind = false,
  knownEndedCaughtUp = false,
): LibrarySubState {
  // == null (inte falsy): säsong 0 (Specials) är giltig progress.
  if (item.lastWatchedSeason == null) return 'ej_paborjad';
  if (knownBehind) return 'ligger_efter';
  if (knownEndedCaughtUp) return 'avslutad';
  if (item.tmdbStatus != null && isEndedStatus(item.tmdbStatus) && item.totalSeasons != null) {
    return item.lastWatchedSeason < item.totalSeasons ? 'ligger_efter' : 'avslutad';
  }
  return 'paborjad';
}

// Sektionsordning: mest aktionerbart först.
export const LIBRARY_SUB_STATE_ORDER: LibrarySubState[] = [
  'ligger_efter', 'paborjad', 'ej_paborjad', 'avslutad',
];

export const LIBRARY_SECTION_LABELS: Record<LibrarySubState, string> = {
  ligger_efter: 'Ligger efter',
  // "Påbörjade" (inte "Pågående"): den här catch-all-sektionen påstår bara att
  // DU har börjat — inte att SERIEN sänds. En avslutad serie utan backfillad
  // status kan hamna här innan rådgivaren laddat, och "Pågående" vore då fel.
  paborjad: 'Påbörjade',
  ej_paborjad: 'Ej påbörjade',
  avslutad: 'Avslutade',
};

// "S2E10" / "S3" — vad användaren senast sett, enligt persisterade fält.
export function seenEpisodeCode(item: WatchlistItem): string | null {
  if (item.lastWatchedSeason == null) return null;
  return item.lastWatchedEpisode != null
    ? `S${item.lastWatchedSeason}E${item.lastWatchedEpisode}`
    : `S${item.lastWatchedSeason}`;
}

export type ProgressTone = 'done' | 'accent' | 'muted';

// Exhaustiv per sub-state (B2): inga bara "—" för TV — varje tillstånd får en
// begriplig etikett som bara påstår vad vi faktiskt vet.
export function libraryProgressLabel(
  item: WatchlistItem,
  subState: LibrarySubState,
  upcomingWeekday: string | null,
): { text: string; tone: ProgressTone } {
  switch (subState) {
    case 'avslutad':
      return { text: 'Avslutad', tone: 'done' };
    case 'ej_paborjad':
      return { text: 'Ej påbörjad', tone: 'muted' };
    case 'ligger_efter': {
      const code = seenEpisodeCode(item);
      return { text: code ? `Ligger efter · ${code} sedd` : 'Ligger efter', tone: 'accent' };
    }
    case 'paborjad': {
      if (upcomingWeekday) return { text: `Nytt ${upcomingWeekday}`, tone: 'accent' };
      const code = seenEpisodeCode(item);
      return { text: code ? `${code} sedd` : 'Påbörjad', tone: 'muted' };
    }
  }
}

// === Standfirst-copy (B1/B5) ===
// Enda källan för sidans räknarmening — sektionsräknare i kortvyn refererar
// samma totalsumma ("X av Y") så de två siffrorna alltid går ihop.
export function buildStandfirst(
  visible: number,
  total: number,
  status: WatchStatus | undefined,
  mediaFilter: 'all' | 'tv' | 'movie',
): string {
  const sing = mediaFilter === 'tv' ? 'serie' : mediaFilter === 'movie' ? 'film' : 'titel';
  const plur = mediaFilter === 'tv' ? 'serier' : mediaFilter === 'movie' ? 'filmer' : 'titlar';
  if (total === 0) {
    return 'Inget i biblioteket än. Hitta något att titta på via Rekommendationer.';
  }
  if (visible === 0) {
    return `Inga ${plur} matchar dina filter. Justera ovan eller rensa.`;
  }
  if (visible === total) {
    return `${pluralSv(visible, sing, plur)} i ${status ? 'denna lista' : 'biblioteket'}. Vi räknade åt dig.`;
  }
  return `${visible} av ${total} ${plur} visas. Filtrera mer eller justera vyn.`;
}

// === Bibliotekets filterrad (BIN-44) — rena, klient-sidiga axlar ===
// Provider + typ filtreras redan på sidan; dessa lägger till genre + betyg
// (sub-state filtreras i komponenten via subStateOf eftersom den behöver
// rådgivarens behind-set). Allt på redan inläst watchlist-data — noll TMDB.

/** OR-match på genre (titeln har minst en av de valda) + lägsta betyg. */
export function itemPassesGenreRating(
  item: WatchlistItem,
  genreIds: number[],
  minRating: number | null,
): boolean {
  if (genreIds.length > 0 && !genreIds.some(g => item.genreIds.includes(g))) return false;
  if (minRating != null && (item.rating == null || item.rating < minRating)) return false;
  return true;
}

/** De genrer som faktiskt finns i den givna listan, sorterade på svenskt namn —
 *  så filterchips bara visar relevanta val (inte alla 26 TMDB-genrer). */
export function genresInLibrary(items: WatchlistItem[]): { id: number; name: string }[] {
  const ids = new Set<number>();
  for (const i of items) for (const g of i.genreIds ?? []) ids.add(g);
  return Array.from(ids)
    .map(id => ({ id, name: genreLabel(id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

// === Taggfilter (BIN-164) — samma klient-sidiga, noll-TMDB-mönster som genre ===
// item.tags är in-memory-hydrerad från den ägar-skyddade watchlistTags-
// subcollectionen (se WatchlistItem-typen) — aldrig från watchlist-doc:t.

/** OR-match på taggar (case-insensitiv, sv-SE), speglar genre-chipsens semantik:
 *  titeln passerar om den har MINST en av de valda taggarna. Tom lista = allt. */
export function itemPassesTags(item: WatchlistItem, selectedTags: string[]): boolean {
  if (selectedTags.length === 0) return true;
  const owned = new Set((item.tags ?? []).map(t => t.toLocaleLowerCase('sv-SE')));
  return selectedTags.some(t => owned.has(t.toLocaleLowerCase('sv-SE')));
}

/** De taggar som faktiskt finns i listan, deduplicerade (sv-SE-fold, första
 *  visnings-casing behålls), sorterade på svenska — driver filterchipsen så
 *  bara verkligt använda taggar visas (och raden döljs helt när listan är tom). */
export function tagsInLibrary(items: WatchlistItem[]): string[] {
  const seen = new Map<string, string>(); // fold → display
  for (const i of items) for (const t of i.tags ?? []) {
    const fold = t.toLocaleLowerCase('sv-SE');
    if (!seen.has(fold)) seen.set(fold, t);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'sv'));
}
