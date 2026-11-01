/**
 * Rena hjälpfunktioner för TV-översikten. Ingen Firebase-import, så de testas utan emulator.
 *
 * Funktionen kör som Admin SDK och kringgår reglerna: allt reglerna annars gav gratis
 * (vem som får se vad) kodas därför här, och alltid så att okänt betyder dolt.
 */

import { createHash } from 'node:crypto';

export const MAX_HOUSEHOLD_MEMBERS = 6;
export const MAX_ITEMS_PER_MEMBER = 150;
export const MAX_TITLES_PER_LIST = 24;
export const MAX_NAME_LENGTH = 24;

/**
 * Samma tabell som webbens migrateStatus och TV-appens StatusMigration: gamla poster ligger kvar
 * med äldre statusvärden och varje läsare måste normalisera dem, så Ikväll och hushållsvyn svarar lika.
 */
export function normalizeStatus(raw: unknown, isMovie: boolean, dropped: boolean): string {
  if (dropped) return 'avbruten';
  switch (raw) {
    case 'watching': case 'följer': case 'watched': case 'sedd': case 'mina':
      return isMovie ? 'sedd' : 'mina';
    case 'want_to_watch': case 'vill_se':
      return isMovie ? 'vill_se' : 'mina';
    case 'dropped': case 'avbruten':
      return 'avbruten';
    default:
      return isMovie ? 'vill_se' : 'mina';
  }
}

/** Råvärdena som kan normaliseras till vill se eller följer; frågan hämtar bara dem. */
export const OPEN_RAW_STATUSES = ['vill_se', 'mina', 'följer', 'want_to_watch', 'watching'] as const;

export type WatchItem = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  status: string | null;
  season: number | null;
  episode: number | null;
};

export type TitleOut = { tmdbId: number; mediaType: 'movie' | 'tv'; title: string; posterPath: string | null };

/**
 * En titel delas bara när den uttryckligen är publik. `friends` delas inte: reglerna släpper bara
 * in ägarens vänner, och en hushållsmedlem är inte automatiskt vän. Reglerna läser
 * `effectiveVisibility`; ett äldre dokument saknar det och styrs av `isPublic`. Saknas båda
 * döljs titeln, aldrig tvärtom.
 */
export function isPrivateItem(doc: Record<string, unknown>): boolean {
  // Finns fältet alls styr det ensamt, som i reglerna: bara 'public' delas, även om värdet är null eller fel typ.
  if ('effectiveVisibility' in doc) return doc.effectiveVisibility !== 'public';
  return doc.isPublic !== true;
}

function posterOrNull(v: unknown): string | null {
  return typeof v === 'string' && /^\/[A-Za-z0-9_.-]{1,80}$/.test(v) ? v : null;
}

/** Bygger en rad ur ett watchlist-dokument, eller null om den är privat eller trasig. */
export function toWatchItem(doc: Record<string, unknown>): WatchItem | null {
  if (isPrivateItem(doc)) return null;
  const tmdbId = doc.tmdbId;
  const title = doc.title;
  const mediaType = doc.mediaType === 'movie' ? 'movie' : doc.mediaType === 'tv' ? 'tv' : null;
  if (typeof tmdbId !== 'number' || !Number.isInteger(tmdbId) || tmdbId <= 0) return null;
  if (typeof title !== 'string' || title.length === 0 || !mediaType) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
  return {
    tmdbId,
    mediaType,
    title: title.slice(0, 100),
    posterPath: posterOrNull(doc.posterPath),
    status: normalizeStatus(doc.status, mediaType === 'movie', doc.dropped === true),
    season: num(doc.lastWatchedSeason),
    episode: num(doc.lastWatchedEpisode),
  };
}

/** Förnamn eller initial med fast längdgräns. Namnet är användarinmatat och visas på en delad skärm. */
export function displayLabel(raw: unknown): { name: string; initial: string } {
  const first = typeof raw === 'string' ? raw.trim().split(/\s+/)[0] ?? '' : '';
  const name = Array.from(first).slice(0, MAX_NAME_LENGTH).join('');
  const initial = Array.from(name)[0]?.toUpperCase() ?? '?';
  return { name, initial };
}

const key = (i: { tmdbId: number; mediaType: string }) => `${i.mediaType}_${i.tmdbId}`;
const out = (i: WatchItem): TitleOut => ({ tmdbId: i.tmdbId, mediaType: i.mediaType, title: i.title, posterPath: i.posterPath });

/** Vill se: filmer med vill_se och serier som följs men inte påbörjats. */
export function isWanted(i: WatchItem): boolean {
  if (i.mediaType === 'movie') return i.status === 'vill_se';
  return (i.status === 'mina' || i.status === 'vill_se') && i.season == null;
}

export type Ikapp = { tmdbId: number; title: string; posterPath: string | null; progress: { member: number; season: number; episode: number }[] };

export type HouseholdView = {
  shared: TitleOut[];
  onlyOne: { member: number; titles: TitleOut[] }[];
  ikapp: Ikapp[];
};

/**
 * Hushållsvyn för dem som sitter i soffan. `lists[i]` är medlem i:s delbara rader.
 * "Bara en vill se" pekar ut en person. Den visas bara för dem som själva satt sig i soffan
 * (listorna läses bara för dem) och bara med två eller tre där; med en finns inget att jämföra.
 */
export function buildHouseholdView(seated: number[], lists: Map<number, WatchItem[]>): HouseholdView {
  const members = seated.filter((m) => lists.has(m));
  const wanted = new Map<number, Map<string, WatchItem>>();
  for (const m of members) {
    wanted.set(m, new Map((lists.get(m) ?? []).filter(isWanted).map((i) => [key(i), i])));
  }

  const counts = new Map<string, { item: WatchItem; who: number[] }>();
  for (const m of members) {
    for (const [k, item] of wanted.get(m) ?? []) {
      const cur = counts.get(k);
      if (cur) cur.who.push(m);
      else counts.set(k, { item, who: [m] });
    }
  }

  const shared = members.length >= 2
    ? [...counts.values()].filter((c) => c.who.length === members.length).map((c) => out(c.item))
    : [];
  const onlyOne = members.length >= 2 && members.length <= 3
    ? members.map((m) => ({
        member: m,
        titles: [...counts.values()].filter((c) => c.who.length === 1 && c.who[0] === m).map((c) => out(c.item)).slice(0, MAX_TITLES_PER_LIST),
      }))
    : [];

  const tv = new Map<string, { item: WatchItem; progress: Ikapp['progress'] }>();
  for (const m of members) {
    for (const i of lists.get(m) ?? []) {
      if (i.mediaType !== 'tv' || i.status !== 'mina' || i.season == null) continue;
      const cur = tv.get(key(i)) ?? { item: i, progress: [] };
      cur.progress.push({ member: m, season: i.season, episode: i.episode ?? 0 });
      tv.set(key(i), cur);
    }
  }
  const ikapp = [...tv.values()]
    .filter((t) => t.progress.length >= 2)
    .map((t) => ({ tmdbId: t.item.tmdbId, title: t.item.title, posterPath: t.item.posterPath, progress: t.progress }));

  return {
    shared: shared.slice(0, MAX_TITLES_PER_LIST),
    onlyOne,
    ikapp: ikapp.slice(0, MAX_TITLES_PER_LIST),
  };
}

/** Indexlistan från TV:n: bara heltal inom medlemsgränsen, utan dubbletter. */
export function parseSeated(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  for (const v of raw) {
    if (Number.isInteger(v) && (v as number) >= 0 && (v as number) < MAX_HOUSEHOLD_MEMBERS) seen.add(v as number);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Tjänste-id:n ur ägarens profil: bara positiva heltal, högst 100. */
export function parseProviders(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is number => Number.isInteger(v) && v > 0).slice(0, 100);
}

/** Vilka medlemmar som själva delar: bara dem vars egen hushållsrad finns (share-to-see, ADR 0010). */
export function sharingUidsOf(rows: { id: string; exists: boolean }[]): Set<string> {
  return new Set(rows.filter((r) => r.exists).map((r) => r.id));
}

/**
 * Hushållets platser: ägaren först, därefter bara de medlemmar som fortfarande är med i gruppen
 * OCH själva delar (har en egen hushållsrad). Ordningen följer `memberUids`; taket är fast.
 */
export function householdUids(ownerUid: string, memberUids: string[], sharingUids: Set<string>): string[] {
  const others = memberUids.filter((u) => u !== ownerUid && sharingUids.has(u));
  return [ownerUid, ...others].slice(0, MAX_HOUSEHOLD_MEMBERS);
}

/** Kvitto på vilka personer platserna pekar på, en hash av uid-listan. */
export function rosterOf(uids: string[]): string {
  return createHash('sha256').update(uids.join('|')).digest('hex').slice(0, 16);
}

/**
 * Platserna är positioner i en lista som byggs om vid varje anrop. Skickar TV:n ett kvitto som inte
 * stämmer har hushållet ändrats och index pekar på andra personer: då gäller bara ägaren (plats 0).
 * Utan kvitto (första anropet) nollställs inget. Platser utanför listan tas bort.
 */
export function resolveSeating(
  clientRoster: string | null,
  roster: string,
  requested: number[],
  memberCount: number,
): { seated: number[]; seatingReset: boolean } {
  const seatingReset = clientRoster !== null && clientRoster !== roster;
  const seated = (seatingReset ? [0] : requested).filter((i) => i < memberCount);
  return { seated, seatingReset };
}
