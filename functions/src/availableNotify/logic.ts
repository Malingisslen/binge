/**
 * Pure qualification logic for "available on my services" push (BIN-60).
 *
 * No firebase-admin import — runs under the root Vitest suite. The function
 * detects when a watchlist title NEWLY appears on a flatrate provider the user
 * subscribes to, and pushes once.
 *
 * Design contract:
 *   - FIRST OBSERVATION ESTABLISHES A BASELINE (last === null → no notify). We
 *     never push for titles that are already available the first time we see
 *     them — that would spam every catalogue match on the first run / when a
 *     title is added. We only push on a *transition* onto a new provider.
 *   - AT-MOST-ONCE: the per-title marker advances after each run regardless of
 *     individual push success (same as episodeNotify) — idempotent, no retry.
 */

export interface WatchlistTitleLite {
  uid: string;
  tmdbId: number;
  mediaType: string;
  status: string;
  title: string;
}

export interface UserNotifSettings {
  availableOnMyServices: boolean;
  pushEnabled: boolean;
}

// Minimal alias→canonical provider map, mirrored from SWEDISH_PROVIDERS in
// src/lib/tmdb/providers.ts (functions can't import @/ aliases). KEEP IN SYNC.
// TMDB sometimes lists one service under several ids; the client stores
// myProviders + the notif inbox keys on the canonical id, so the server must
// canonicalise too — otherwise it (a) misses titles on an aliased provider the
// user has, and (b) writes a notif id that won't dedupe against the inbox's
// `${stateId}-${canonicalId}` convention (BIN-529: stateId is the
// media-type-namespaced `${mediaType}_${tmdbId}`, not bare tmdbId — see
// inboxNotifId below).
// Exported (frozen) so the root-vitest parity test in
// src/lib/tmdb/providerAliasParity.test.ts can assert this mirror still matches
// SWEDISH_PROVIDERS.aliases and fail CI on any future drift (BIN-420). Frozen so
// an importer can't mutate the shared map and silently corrupt canonicalisation.
export const ALIAS_TO_CANONICAL: Readonly<Record<number, number>> = Object.freeze({
  1899: 384, 1825: 384,   // Max
  493: 520,               // SVT Play
  1944: 489, 1759: 489,   // TV4 Play
  2243: 350,              // Apple TV+
  1968: 323, 283: 323,    // Crunchyroll
  1773: 431, 531: 431,    // SkyShowtime (531 = nedlagda Paramount+ → efterträdaren)
  188: 335,               // YouTube Premium
  497: 521,               // Tele2 Play
  517: 578,               // TriArt Play
});

export function canonicalProviderId(id: number): number {
  return ALIAS_TO_CANONICAL[id] ?? id;
}

/**
 * TMDB movie ids and TV ids are INDEPENDENT namespaces — movie N and TV N are
 * unrelated titles. Anything keyed per-title must therefore key on
 * (mediaType, tmdbId), never tmdbId alone (BIN-523). Unknown/blank mediaType
 * normalizes to 'tv', matching the long-standing fetch/actionUrl fallback.
 */
export type NotifyMediaType = 'movie' | 'tv';

export function normalizeMediaType(raw: string): NotifyMediaType {
  return raw === 'movie' ? 'movie' : 'tv';
}

/**
 * Doc id for availableNotifyState AND the phase-2 grouping key (BIN-523):
 * `movie_${tmdbId}` / `tv_${tmdbId}`. Before this, movie N and TV N collapsed
 * into one group keyed on bare tmdbId — one arbitrary mediaType won the TMDB
 * fetch and both media shared a lastFlatrate baseline.
 *
 * Reading behavior for legacy bare-`${tmdbId}` docs is NOT decided here —
 * see `readLastFlatrate` in index.ts (2026-07-19) for the authoritative,
 * current answer: a one-successful-run fallback read, not a permanent
 * orphan. Don't restate the tradeoff in this file; it drifts.
 */
export function availableStateDocId(mediaType: string, tmdbId: number): string {
  return `${normalizeMediaType(mediaType)}_${tmdbId}`;
}

/**
 * Inbox notification doc id under users/{uid}/notifications (BIN-529). Rides
 * the same media-type-namespaced stateId as availableStateDocId/the FCM tag —
 * before this fix a movie and a TV show sharing a tmdbId AND gaining the same
 * provider would merge-overwrite one inbox card (mediaType/title flip,
 * read-state reset). Old bare-`${tmdbId}-${providerId}` docs are just
 * already-delivered cards; no migration needed.
 */
export function inboxNotifId(mediaType: string, tmdbId: number, providerId: number): string {
  return `${availableStateDocId(mediaType, tmdbId)}-${providerId}`;
}

/**
 * Provider ids present in `current` that were not in `last`. `last === null`
 * (no prior observation) yields [] — baseline only, never a first-run blast.
 */
export function diffNewProviders(current: number[], last: number[] | null): number[] {
  if (last === null) return [];
  const lastSet = new Set(last);
  return current.filter((p) => !lastSet.has(p));
}

/**
 * The newly-available providers the user actually subscribes to — empty means
 * no push. Gated on both availableOnMyServices and pushEnabled (defensive; the
 * push layer re-checks pushEnabled too). settings === null (user-doc missing)
 * → no push.
 */
export function qualifyingProviders(
  settings: UserNotifSettings | null,
  newProviders: number[],
  myProviders: number[],
): number[] {
  if (!settings || !settings.availableOnMyServices || !settings.pushEnabled) return [];
  const mine = new Set(myProviders);
  return newProviders.filter((p) => mine.has(p));
}
