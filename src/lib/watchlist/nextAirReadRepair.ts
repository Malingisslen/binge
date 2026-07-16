import { getNextAirInfo, streamingProviderName } from '@/lib/calendar/nextAir';
import { pickSwedishDigitalRelease } from '@/lib/calendar/releaseDate';
import { stampOlderThan } from '@/lib/watchlist/tmdbFieldsRefresh';
import type { TMDBTVShow, TMDBMovie, WatchlistItem } from '@/types';

// Instant week (2026-07): tyst read-repair av denormaliserade next-air-fält på
// watchlist-docs. Regler (bindande, från stakeholder-panelen):
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

// BIN-468 A3: nextAirUpdatedAt is the next-air group's freshness stamp for the
// ToS sweep. A settled digitalReleaseDate (or an ended show's air fields) never
// changes → without this the stamp would FREEZE at first-write → the sweep clears
// the group at 5mo → the next Calendar visit re-writes it → a recurring
// clear-then-repair cycle. So we also re-stamp (value-unchanged) once the stamp
// crosses this interval, keeping it under the 5-month sweep threshold for any
// calendar-active user. Well under 5mo so an active user is never swept.
export const NEXTAIR_RESTAMP_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/** True when nextAirUpdatedAt is absent or older than the re-stamp interval. */
export function nextAirStampStale(stamp: Date | null | undefined, now: number): boolean {
  return stampOlderThan(stamp, now, NEXTAIR_RESTAMP_INTERVAL_MS);
}

/** Whether the item currently holds any non-null next-air/digital-release value. */
function hasNextAirData(item: WatchlistItem): boolean {
  return item.nextAirDate != null || item.nextAirCode != null
    || item.nextAirProvider != null || item.digitalReleaseDate != null;
}

/**
 * The update (if any) for one item: a value delta when something changed, else a
 * stamp-only refresh ({} delta → buildRepairPayload writes just nextAirUpdatedAt)
 * when the item holds data and its stamp is stale — so stable data keeps a fresh
 * stamp instead of freezing. Nothing for a dataless item (nothing to attest).
 */
function updateForItem(
  item: WatchlistItem,
  computed: Partial<Record<RepairableKey, string | null>>,
  now: number,
): NextAirUpdate | null {
  const delta = nextAirDelta(item, computed);
  if (delta) return { tmdbId: item.tmdbId, delta };
  if (hasNextAirData(item) && nextAirStampStale(item.nextAirUpdatedAt, now)) {
    return { tmdbId: item.tmdbId, delta: {} };
  }
  return null;
}

export function collectNextAirUpdates(
  items: WatchlistItem[],
  shows: TMDBTVShow[],
  movies: TMDBMovie[],
  now: number,
): NextAirUpdate[] {
  const byId = new Map(items.map(i => [i.tmdbId, i]));
  const updates: NextAirUpdate[] = [];
  for (const show of shows) {
    const item = byId.get(show.id);
    if (!item || item.mediaType !== 'tv') continue;
    const u = updateForItem(item, computeNextAirFields(show), now);
    if (u) updates.push(u);
  }
  for (const movie of movies) {
    const item = byId.get(movie.id);
    if (!item || item.mediaType !== 'movie') continue;
    const u = updateForItem(item, computeMovieReleaseFields(movie), now);
    if (u) updates.push(u);
  }
  return updates;
}

// Session-dedupe: en (uid, tmdbId) skrivs högst en gång per session — skyddar
// mot StrictMode-dubbeleffekter och re-render-churn. Markeras FÖRE await så en
// parallell flush inte dubblerar (concurrency-vakten). BIN-518: markeringen är
// dock inte ett "skrivet"-löfte — en chunk vars commit REJEKTAR rullas tillbaka
// (marks tas bort) så dess items får försöka igen nästa flush/session istället
// för att frysa till nästa sidladdning. Per-chunk try/catch → en trasig chunk
// blockerar inte senare chunkar.
const writtenThisSession = new Set<string>();

export async function flushNextAirWrites(uid: string, updates: NextAirUpdate[]): Promise<void> {
  const keyOf = (u: NextAirUpdate) => `${uid}:${u.tmdbId}`;
  const pending = updates.filter(u => !writtenThisSession.has(keyOf(u)));
  if (pending.length === 0) return;
  pending.forEach(u => writtenThisSession.add(keyOf(u)));
  try {
    // Dynamisk import — INTE top-level: modulens rena hälft (compute/delta/
    // collect) unit-testas utan Firebase i test-miljön (repo-mönstret för
    // pure-logic helpers). fsdb är dessutom redan lat internt.
    const { fsdb } = await import('@/lib/firebase/db');
    const { db, doc, writeBatch, serverTimestamp } = await fsdb();
    // Firestore-batchtak är 500 ops; chunka vid 450 (AuthContext-precedent).
    for (let i = 0; i < pending.length; i += 450) {
      const chunk = pending.slice(i, i + 450);
      const batch = writeBatch(db);
      for (const u of chunk) {
        batch.set(
          doc(db, 'users', uid, 'watchlist', String(u.tmdbId)),
          // OBS: ALDRIG updatedAt här — payload-byggaren är testlåst på det.
          buildRepairPayload(u.delta, serverTimestamp()),
          { merge: true },
        );
      }
      try {
        await batch.commit();
      } catch (err) {
        // Denna chunk skrevs aldrig → rulla tillbaka dess dedupe-marks så dess
        // items försöker igen (best-effort, setRuntime-mönstret). Fortsätt med
        // resten av chunkarna.
        chunk.forEach(u => writtenThisSession.delete(keyOf(u)));
        console.warn('[watchlist] next-air read-repair batch misslyckades:', err);
      }
    }
  } catch (err) {
    // Importen/fsdb() föll — ingenting skrevs → rulla tillbaka allt.
    pending.forEach(u => writtenThisSession.delete(keyOf(u)));
    console.warn('[watchlist] next-air read-repair misslyckades:', err);
  }
}
