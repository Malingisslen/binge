import type { CalendarEntry, EpisodeEntry } from './types';
import { entryKey } from './entry';
import { getDisplayTitle } from '@/lib/tmdb/client';
import type { TMDBSearchResult, TMDBTVShow, WatchlistItem } from '@/types';

// "Premiärer & finaler" — kvartalshorisonten (13 veckor) av landmärken:
// säsongspremiärer, säsongsfinaler och digitala filmsläpp. Byggd ovanpå exakt
// samma entries som veckokalendern (useCalendarEntries) plus premiär-"pills"
// härledda ur de denormaliserade next-air-fälten — noll ny datainsamling.
//
// DOKUMENTERADE BEGRÄNSNINGAR (medvetna, skyltade ärligt i sidans standfirst):
//  * Finaler bortom den ENDA säsong kalendern hämtar är okända (isFinale är
//    konservativ per BIN-13) — kvartalsvyn visar finaler bara för säsonger som
//    redan sänds.
//  * Pills är premiär-only (E1-koder); mittsäsongs-återkomster av ännu ohämtade
//    säsonger syns inte.
//  * TV i 'vill_se' finns inte i kalender-pipelinen (och exkluderas ur
//    upptäckten) — samma beteende som /calendar/ idag.

export const QUARTER_WEEKS = 13;

export interface PremiereWindow {
  /** yyyy-mm-dd, inklusive. */
  startIso: string;
  /** yyyy-mm-dd, EXKLUSIVE — fönstret är [startIso, endIso). */
  endIso: string;
}

const CODE_RE = /^S(\d+)E(\d+)$/;

const MONTHS_SV = [
  'januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december',
];

function isoKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function inWindow(airDate: string, window: PremiereWindow): boolean {
  return airDate >= window.startIso && airDate < window.endIso;
}

/**
 * [idag, idag+91 dagar). DST-säkert: setDate-stride på lokala datum-komponenter
 * (aldrig fasta millisekunder — BIN-105). Formateras via lokala YYYY-MM-DD så
 * fönstret matchar entries.airDate exakt.
 */
export function quarterWindow(now: Date = new Date()): PremiereWindow {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + QUARTER_WEEKS * 7); // 91 dagar
  return { startIso: isoKey(start), endIso: isoKey(end) };
}

/**
 * Serie-ids som har MINST ETT avsnitts-entry inuti fönstret. Speglar
 * useAdvisorTimelines "touched"-logik: en serie som kalendern redan täcker
 * behöver ingen härledd premiär-pill. Filmsläpp räknas aldrig.
 */
export function coveredTmdbIdsInWindow(
  entries: readonly CalendarEntry[],
  window: PremiereWindow,
): Set<number> {
  const covered = new Set<number>();
  for (const e of entries) {
    if (e.kind !== 'episode') continue;
    if (inWindow(e.airDate, window)) covered.add(e.tmdbId);
  }
  return covered;
}

/**
 * Premiär-pills ur de denormaliserade next-air-fälten för serier du följer
 * vars kommande säsong kalendern inte kan se (ännu ej sänd). Tas med endast om:
 * mediaType 'tv', status 'mina', ej avbruten, nextAirDate i fönstret, tmdbId
 * INTE redan täckt av kalendern, och nextAirCode är S…E1 (bara äkta premiärer —
 * mittsäsongs-återkomster hör inte hemma här). Finaler är okända från detta
 * fält, så isFinale är alltid false. Rad-mönstret speglar seedEntries.ts.
 */
export function derivePremierePills(
  items: readonly WatchlistItem[],
  covered: ReadonlySet<number>,
  window: PremiereWindow,
): EpisodeEntry[] {
  const out: EpisodeEntry[] = [];
  for (const item of items) {
    if (item.dropped) continue;
    if (item.mediaType !== 'tv' || item.status !== 'mina') continue;
    if (!item.nextAirDate || !inWindow(item.nextAirDate, window)) continue;
    if (covered.has(item.tmdbId)) continue;
    const match = CODE_RE.exec(item.nextAirCode ?? '');
    if (!match) continue;
    const season = Number(match[1]);
    const episode = Number(match[2]);
    if (episode !== 1) continue;
    out.push({
      kind: 'episode',
      mediaType: 'tv',
      tmdbId: item.tmdbId,
      title: item.title,
      posterPath: item.posterPath,
      backdropPath: null,
      season,
      episode,
      episodeCode: item.nextAirCode as string,
      airDate: item.nextAirDate,
      provider: item.nextAirProvider ?? undefined,
      isPremiere: true,
      isFinale: false,
      genreIds: item.genreIds,
    });
  }
  return out;
}

/**
 * Kvartalets händelser: i fönstret OCH (filmsläpp ∨ premiär ∨ final). Deduplicerar
 * på entryKey — anropa med [...liveEntries, ...pills] så en live-entry vinner
 * över en pill för samma avsnitt. Sorterar på airDate stigande, sedan sv titel.
 */
export function selectQuarterEvents(
  entries: readonly CalendarEntry[],
  window: PremiereWindow,
): CalendarEntry[] {
  const seen = new Set<string>();
  const out: CalendarEntry[] = [];
  for (const e of entries) {
    if (!inWindow(e.airDate, window)) continue;
    const isEvent = e.kind === 'movie' || e.isPremiere || e.isFinale;
    if (!isEvent) continue;
    const key = entryKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  out.sort((a, b) =>
    a.airDate < b.airDate ? -1
      : a.airDate > b.airDate ? 1
        : a.title.localeCompare(b.title, 'sv'),
  );
  return out;
}

export interface MonthGroup {
  /** yyyy-mm. */
  key: string;
  /** 'Juli' inom innevarande år, 'Januari 2027' när kvartalet korsar årsskiftet. */
  label: string;
  entries: CalendarEntry[];
}

function monthLabel(key: string, currentYear: number): string {
  const [year, month] = key.split('-').map(Number);
  const name = MONTHS_SV[month - 1];
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
  return year === currentYear ? capitalized : `${capitalized} ${year}`;
}

/**
 * Grupperar (redan sorterade) händelser per månad, i kronologisk ordning.
 * Årsskifte får årssuffix på etiketten.
 */
export function groupEntriesByMonth(
  entries: readonly CalendarEntry[],
  now: Date = new Date(),
): MonthGroup[] {
  const currentYear = now.getFullYear();
  const groups: MonthGroup[] = [];
  const byKey = new Map<string, MonthGroup>();
  for (const e of entries) {
    const key = e.airDate.slice(0, 7);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: monthLabel(key, currentYear), entries: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.entries.push(e);
  }
  return groups;
}

export interface DiscoveryPremiere {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  /** Premiärdatum: first_air_date för nya serier (S1), next_episode_to_air.air_date för återkomster. */
  airDate: string;
  /** 1 = helt ny serie, ≥2 = ny säsong av en serie du inte följer. Driver badgen (premiär/säsong N). */
  seasonNumber: number;
  genreIds: number[];
  overview: string;
}

/**
 * Stora kommande seriepremiärer att UPPTÄCKA — NYA serier (S1) i fönstret som
 * användaren inte redan följer/avfärdat. Filtrerar bort: saknat/utanför-fönster
 * first_air_date, exkluderade ids, saknad poster. Deduplicerar över sidor,
 * behåller TMDB:s popularitetsordning, cappar till `cap`. Titel via
 * getDisplayTitle (föredrar originaltitel i latinsk skrift, annars sv-SE).
 */
export function selectDiscoveryPremieres(
  results: readonly TMDBSearchResult[],
  excludedIds: ReadonlySet<number>,
  window: PremiereWindow,
  cap = 12,
): DiscoveryPremiere[] {
  const seen = new Set<number>();
  const out: DiscoveryPremiere[] = [];
  for (const r of results) {
    if (out.length >= cap) break;
    const firstAir = r.first_air_date;
    if (!firstAir || !inWindow(firstAir, window)) continue;
    if (excludedIds.has(r.id)) continue;
    if (!r.poster_path) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      tmdbId: r.id,
      title: getDisplayTitle(r),
      posterPath: r.poster_path,
      airDate: firstAir,
      seasonNumber: 1,
      genreIds: r.genre_ids ?? [],
      overview: r.overview,
    });
  }
  return out;
}

/**
 * Fas 2 — UPPCOMMANDE SÄSONGSPREMIÄRER (säsong ≥ 2, avsnitt 1) för RETURNERANDE
 * serier du inte följer. Tar en pool av tv-lite-detaljer (redan hämtade via en
 * capad fan-out) och behåller dem vars `next_episode_to_air` är en säsongspremiär
 * i fönstret. En återkomsts premiärdatum är INTE seriens first_air_date, så detta
 * kräver per-titel-detaljen (discover:s air_date-filter är bara en grov förfilter).
 * Cappar, deduplicerar på id, mappar `genres`-objekten → id-array för duotone.
 */
export function selectSeasonPremiereDiscoveries(
  shows: readonly TMDBTVShow[],
  excludedIds: ReadonlySet<number>,
  window: PremiereWindow,
  cap = 12,
): DiscoveryPremiere[] {
  const seen = new Set<number>();
  const out: DiscoveryPremiere[] = [];
  for (const show of shows) {
    if (out.length >= cap) break;
    const next = show.next_episode_to_air;
    if (!next) continue;
    if (next.season_number < 2 || next.episode_number !== 1) continue;
    if (!next.air_date || !inWindow(next.air_date, window)) continue;
    if (excludedIds.has(show.id)) continue;
    if (!show.poster_path) continue;
    if (seen.has(show.id)) continue;
    seen.add(show.id);
    out.push({
      tmdbId: show.id,
      title: getDisplayTitle(show),
      posterPath: show.poster_path,
      airDate: next.air_date,
      seasonNumber: next.season_number,
      genreIds: show.genres?.map(g => g.id) ?? [],
      overview: show.overview,
    });
  }
  return out;
}

/**
 * Slår ihop nya-serier-listan (S1) med återkomst-listan (S≥2) till EN datumsorterad
 * "Upptäck"-rad. S1 först i indata → vinner vid id-krock (en serie kan inte vara
 * både helt ny och återkommande, men vakten är billig). Sorterar på airDate, sedan
 * sv titel; cappar totalen.
 */
export function mergeDiscoveries(
  primary: readonly DiscoveryPremiere[],
  secondary: readonly DiscoveryPremiere[],
  cap = 12,
): DiscoveryPremiere[] {
  const seen = new Set<number>();
  const merged: DiscoveryPremiere[] = [];
  for (const d of [...primary, ...secondary]) {
    if (seen.has(d.tmdbId)) continue;
    seen.add(d.tmdbId);
    merged.push(d);
  }
  merged.sort((a, b) =>
    a.airDate < b.airDate ? -1
      : a.airDate > b.airDate ? 1
        : a.title.localeCompare(b.title, 'sv'),
  );
  return merged.slice(0, cap);
}
