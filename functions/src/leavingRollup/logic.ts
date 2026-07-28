// BIN-178 — pure logic for the "vad försvinner" rollup, sourced from MOTN's
// /changes endpoint (change_type=expiring). No firebase-admin import → runs under
// the root Vitest suite.
//
// MOTN's Changes endpoint returns what's actually LEAVING each service in a
// country (independent of which titles we track per-title), which is the right
// source for this surface. We keep only subscription expirations with a known
// date, on a service we have a /forsvinner page for, and collapse them into
// streamingLeaving/current.byProvider keyed by canonical TMDB provider id.

import { canonicalProviderId } from '../availableNotify/logic';
import { mediaTypeDocId } from '../shared/mediaTypeDocId';

export interface LeavingEntry {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  leaving: string; // YYYY-MM-DD
}

export interface LeavingRollup {
  byProvider: Record<string, LeavingEntry[]>;
}

/** One expiring change from MOTN, narrowed to what we need. */
export interface ChangeItem {
  showId: string;
  streamingOptionType: string; // "subscription" | "rent" | "buy" | ...
  serviceId: string;           // MOTN service.id, e.g. "netflix"
  timestamp: number | null;    // unix seconds; null when MOTN omits the exact date
}

/** A show entry from MOTN's `shows` map, narrowed to the TMDB id. */
export interface ShowRef {
  tmdbId?: string; // "movie/597" | "tv/1396"
}

// MOTN service.id → canonical TMDB watch-provider id. Only services we ship a
// /forsvinner page for (SEO_PROVIDER_IDS). A change on any other service is
// dropped. Aliases (hbo→max, svt/svtplay) hedge MOTN id variants; an unmapped
// id is logged by the caller so the map can be extended.
export const MOTN_SERVICE_TO_TMDB: Record<string, number> = {
  netflix: 8,
  prime: 119,
  disney: 337,
  max: 384,
  hbo: 384,
  apple: 350,
  paramount: 531,
  viaplay: 76,
  skyshowtime: 431,
  crunchyroll: 323,
  svt: 520,
  svtplay: 520,
  tv4: 489,
  tv4play: 489,
  discovery: 510,
  discoveryplus: 510,
};

/** Parse MOTN's "<type>/<id>" tmdbId into a media type + numeric id. */
export function parseTmdbRef(tmdbId: string | undefined): { mediaType: 'movie' | 'tv'; id: number } | null {
  if (!tmdbId) return null;
  const slash = tmdbId.indexOf('/');
  if (slash < 0) return null;
  const type = tmdbId.slice(0, slash);
  const id = Number(tmdbId.slice(slash + 1));
  if (!Number.isFinite(id) || id <= 0) return null;
  if (type === 'movie') return { mediaType: 'movie', id };
  if (type === 'tv') return { mediaType: 'tv', id };
  return null;
}

/** Unix seconds → YYYY-MM-DD (UTC). */
export function isoFromUnix(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

/**
 * Build the per-provider leaving rollup from MOTN expiring changes. Keeps only
 * subscription expirations with a known timestamp on a mapped service; resolves
 * the TMDB id via the shows map; soonest leaving wins per (provider, title);
 * each provider's list is sorted nearest-first and capped.
 *
 * "Title" here is (mediaType, tmdbId), never the bare tmdbId — TMDB's movie and
 * tv id spaces are independent, so keying on the number alone would let a film
 * and an unrelated series with the same id evict each other (BIN-586, same bug
 * class as BIN-523 / BIN-529 / BIN-545).
 */
export function buildLeavingRollupFromChanges(
  changes: readonly ChangeItem[],
  shows: Readonly<Record<string, ShowRef>>,
  capPerProvider = 80,
): LeavingRollup {
  const byProviderMap = new Map<number, Map<string, LeavingEntry>>();

  for (const c of changes) {
    if (c.streamingOptionType !== 'subscription' || c.timestamp == null) continue;
    const mapped = MOTN_SERVICE_TO_TMDB[c.serviceId];
    if (mapped == null) continue;
    const ref = parseTmdbRef(shows[c.showId]?.tmdbId);
    if (!ref) continue;

    const pid = canonicalProviderId(mapped);
    const leaving = isoFromUnix(c.timestamp);
    let perTitle = byProviderMap.get(pid);
    if (!perTitle) byProviderMap.set(pid, (perTitle = new Map()));
    const titleKey = mediaTypeDocId(ref.mediaType, ref.id);
    const existing = perTitle.get(titleKey);
    if (!existing || leaving < existing.leaving) {
      perTitle.set(titleKey, { tmdbId: ref.id, mediaType: ref.mediaType, leaving });
    }
  }

  const byProvider: Record<string, LeavingEntry[]> = {};
  for (const [pid, perTitle] of byProviderMap) {
    byProvider[String(pid)] = [...perTitle.values()]
      .sort((a, b) =>
        a.leaving.localeCompare(b.leaving) ||
        a.tmdbId - b.tmdbId ||
        a.mediaType.localeCompare(b.mediaType))
      .slice(0, capPerProvider);
  }
  return { byProvider };
}
