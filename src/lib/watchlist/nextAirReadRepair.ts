import { getNextAirInfo, streamingProviderName } from '@/lib/calendar/nextAir';
import { pickSwedishDigitalRelease } from '@/lib/calendar/releaseDate';
import type { TMDBTVShow, TMDBMovie, WatchlistItem } from '@/types';

// Instant week (2026-07): tyst read-repair av denormaliserade next-air-fält på
// watchlist-docs. Regler (bindande, från stakeholder-panelen — spec
// docs/superpowers/specs/2026-07-02-home-instant-week-design.md):
//   • Skrivs ENDAST härifrån, anropat från EN plats (useCalendar-effekten).
//   • Bumpar ALDRIG updatedAt ("Fortsätt titta" sorterar på den, se
//     continueWatching.ts) — nextAirUpdatedAt är enda tidsstämpeln.
//   • No-op när inget ändrats (null ≡ undefined ≡ frånvarande fält).
//   • Last-write-wins mellan flikar/enheter är ACCEPTERAT: fälten är rent
//     härledda/omräknerliga (jfr communityRatings som INTE får LWW).
//   • Best-effort: fel sväljs (setRuntime-mönstret) — nästa besök reparerar.

export interface NextAirFields {
  nextAirDate: string | null;
  nextAirCode: string | null;
  nextAirProvider: string | null;
}

export function computeNextAirFields(show: TMDBTVShow): NextAirFields {
  const { date, code } = getNextAirInfo(show);
  return {
    nextAirDate: date,
    nextAirCode: code,
    nextAirProvider: streamingProviderName(show['watch/providers']?.results?.SE) ?? null,
  };
}

export function computeMovieReleaseFields(movie: TMDBMovie): { digitalReleaseDate: string | null } {
  return { digitalReleaseDate: pickSwedishDigitalRelease(movie) };
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? null) === (b ?? null);

type RepairableKey = keyof NextAirFields | 'digitalReleaseDate';

export function nextAirDelta(
  item: WatchlistItem,
  fields: Partial<Record<RepairableKey, string | null>>,
): Partial<Record<RepairableKey, string | null>> | null {
  const delta: Partial<Record<RepairableKey, string | null>> = {};
  for (const key of Object.keys(fields) as RepairableKey[]) {
    if (!same(item[key], fields[key])) delta[key] = fields[key] ?? null;
  }
  return Object.keys(delta).length > 0 ? delta : null;
}

export interface NextAirUpdate {
  tmdbId: number;
  delta: Partial<Record<RepairableKey, string | null>>;
}

// Ren payload-byggare — testbar utan Firebase. `stamp` är serverTimestamp()-
// sentineln vid riktig skrivning. INVARIANTEN (spec-villkor 2): payloaden får
// ALDRIG innehålla updatedAt — "Fortsätt titta" sorterar på den. Testet låser
// nyckeluppsättningen så en regression i flush inte kan smyga förbi CI.
//
// BIN-402: denna path skriver BARA nextAir*-delmängden — den bumpar därför INTE
// den doc-nivå TMDB-freshness-stämpeln (tmdbFieldsRefreshedAt), som gäller HELA
// TMDB-blocket (title/posterPath/providers/…). Att stämpla hela blocket här vore
// oärligt: en kalender-aktiv men aldrig-titelsides-visande användare skulle hålla
// title/providers "färska" i evighet utan att de faktiskt hämtats om → skulle
// underminera ToS-sweepen (§1.C). Bara full-block-skrivarna (addItem +
// titelsidans refreshTmdbFields) stämplar. Sweepen rensar nextAir* när blocket är
// stale; nästa kalender-render reparerar dem igen (nextAirUpdatedAt är deras egen
// färskhet). Stämpeln förblir ärlig.
export function buildRepairPayload(
  delta: Partial<Record<RepairableKey, string | null>>,
  stamp: unknown,
): Record<string, unknown> {
  return { ...delta, nextAirUpdatedAt: stamp };
}

export function collectNextAirUpdates(
  items: WatchlistItem[],
  shows: TMDBTVShow[],
  movies: TMDBMovie[],
): NextAirUpdate[] {
  const byId = new Map(items.map(i => [i.tmdbId, i]));
  const updates: NextAirUpdate[] = [];
  for (const show of shows) {
    const item = byId.get(show.id);
    if (!item || item.mediaType !== 'tv') continue;
    const delta = nextAirDelta(item, computeNextAirFields(show));
    if (delta) updates.push({ tmdbId: show.id, delta });
  }
  for (const movie of movies) {
    const item = byId.get(movie.id);
    if (!item || item.mediaType !== 'movie') continue;
    const delta = nextAirDelta(item, computeMovieReleaseFields(movie));
    if (delta) updates.push({ tmdbId: movie.id, delta });
  }
  return updates;
}

// Session-dedupe: en (uid, tmdbId) skrivs högst en gång per session — skyddar
// mot StrictMode-dubbeleffekter och re-render-churn. Markeras FÖRE await så
// en parallell flush inte dubblerar; en misslyckad batch får vänta till nästa
// session (best-effort, setRuntime-mönstret).
const writtenThisSession = new Set<string>();

export async function flushNextAirWrites(uid: string, updates: NextAirUpdate[]): Promise<void> {
  const pending = updates.filter(u => !writtenThisSession.has(`${uid}:${u.tmdbId}`));
  if (pending.length === 0) return;
  pending.forEach(u => writtenThisSession.add(`${uid}:${u.tmdbId}`));
  try {
    // Dynamisk import — INTE top-level: modulens rena hälft (compute/delta/
    // collect) unit-testas utan Firebase i test-miljön (repo-mönstret för
    // pure-logic helpers). fsdb är dessutom redan lat internt.
    const { fsdb } = await import('@/lib/firebase/db');
    const { db, doc, writeBatch, serverTimestamp } = await fsdb();
    // Firestore-batchtak är 500 ops; chunka vid 450 (AuthContext-precedent).
    for (let i = 0; i < pending.length; i += 450) {
      const batch = writeBatch(db);
      for (const u of pending.slice(i, i + 450)) {
        batch.set(
          doc(db, 'users', uid, 'watchlist', String(u.tmdbId)),
          // OBS: ALDRIG updatedAt här — payload-byggaren är testlåst på det.
          buildRepairPayload(u.delta, serverTimestamp()),
          { merge: true },
        );
      }
      await batch.commit();
    }
  } catch (err) {
    console.warn('[watchlist] next-air read-repair misslyckades:', err);
  }
}
