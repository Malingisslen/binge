/**
 * BIN-163 — pure logic for the weekly "lämnar snart + nytt på dina tjänster"
 * digest. No firebase-admin import → runs under the root Vitest suite.
 *
 * The digest rolls library-altitude what today is only a per-title badge:
 *   - LEAVING half: titles in the user's library whose streamingOffers carry a
 *     SUBSCRIPTION offer leaving within `withinDays`, on a provider the user
 *     actually subscribes to (myProviders). Soonest-leaving provider wins per
 *     title; sorted nearest-deadline-first. This is the urgency mechanic.
 *   - NEW half: a COUNT only, summarising arrivals that availableNotify already
 *     delivered per-title this week (the caller reads the user's own recent
 *     `provider_available` inbox docs) — no second detection system, no TMDB.
 *
 * Only subscription offers count for "leaving": a rent/buy window expiring is
 * not "leaving your services". Provider ids are canonicalised on both sides so
 * an aliased provider the user has still matches (see availableNotify/logic).
 */

import { canonicalProviderId } from '../availableNotify/logic';

export interface DigestOffer {
  providerId: number;
  type: string;
  leaving: string | null;
}

export interface DigestTitle {
  tmdbId: number;
  title: string;
  mediaType: 'movie' | 'tv';
}

export interface LeavingItem {
  tmdbId: number;
  title: string;
  mediaType: 'movie' | 'tv';
  leaving: string; // YYYY-MM-DD
  daysLeft: number;
}

const DAY_MS = 86_400_000;

/**
 * Whole-day countdown to a leaving date. A bare YYYY-MM-DD is read as UTC
 * midnight and compared against `nowMs` floored to UTC day, so a title leaving
 * today reads 0 (not negative) all day. Returns null for missing/garbage dates.
 * (The client uses LOCAL midnight for the per-title badge; on a weekly 14-day
 * window a sub-day TZ skew is immaterial and UTC keeps the server deterministic.)
 */
export function daysUntilLeaving(leaving: string | null, nowMs: number): number | null {
  if (!leaving || !/^\d{4}-\d{2}-\d{2}$/.test(leaving)) return null;
  const leavingMs = Date.parse(`${leaving}T00:00:00Z`);
  if (Number.isNaN(leavingMs)) return null;
  const nowDay = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const leavingDay = Math.floor(leavingMs / DAY_MS) * DAY_MS;
  return Math.round((leavingDay - nowDay) / DAY_MS);
}

/**
 * Build the leaving-soon list for one user. `offersByTmdbId` holds the offers
 * from each title's streamingOffers doc; `myProviders` is the user's subscribed
 * set. Each title contributes at most once (its soonest-leaving owned provider);
 * result is sorted nearest-deadline-first.
 */
export function buildLeavingDigest(
  titles: readonly DigestTitle[],
  offersByTmdbId: ReadonlyMap<number, readonly DigestOffer[]>,
  myProviders: readonly number[],
  nowMs: number,
  withinDays = 14,
): LeavingItem[] {
  const mine = new Set(myProviders.map(canonicalProviderId));
  const out: LeavingItem[] = [];
  for (const t of titles) {
    const offers = offersByTmdbId.get(t.tmdbId) ?? [];
    let best: LeavingItem | null = null;
    for (const o of offers) {
      if (o.type !== 'subscription' || !o.leaving) continue;
      if (!mine.has(canonicalProviderId(o.providerId))) continue;
      const daysLeft = daysUntilLeaving(o.leaving, nowMs);
      if (daysLeft === null || daysLeft < 0 || daysLeft > withinDays) continue;
      if (!best || daysLeft < best.daysLeft) {
        best = { tmdbId: t.tmdbId, title: t.title, mediaType: t.mediaType, leaving: o.leaving, daysLeft };
      }
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** True when there's anything worth sending — a leaving item or a new arrival. */
export function hasDigestContent(leavingCount: number, newCount: number): boolean {
  return leavingCount > 0 || newCount > 0;
}

/**
 * Swedish push body. Combines both halves; omits a half that's empty so the
 * copy never reads "0 ...". Caller guarantees at least one is non-zero.
 */
export function digestPushBody(leavingCount: number, newCount: number): string {
  const parts: string[] = [];
  if (leavingCount > 0) {
    parts.push(`${leavingCount} ${leavingCount === 1 ? 'titel lämnar' : 'titlar lämnar'} dina tjänster snart`);
  }
  if (newCount > 0) {
    parts.push(`${newCount} ${newCount === 1 ? 'ny' : 'nya'} den här veckan`);
  }
  return parts.join(' · ');
}
