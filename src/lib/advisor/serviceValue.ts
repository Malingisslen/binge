// BIN-182 — "Behåll eller säg upp?": a backward-looking, per-service value
// verdict from what the user actually watched in a month, priced at their own
// subscription cost. "Viaplay 699 kr — 1 avsnitt (≈699 kr/avsnitt). HBO Max
// 109 kr — 14 h (≈8 kr/h)." Pure rollup logic — the monthly card that renders
// it is Tier-B UI; this module is the testable core.
//
// Distinct from spendSnapshot (BIN-99, forward-looking *cost* of the whole
// library). This measures *value received per service* over a closed month.

import { canonicalProviderId } from '@/lib/tmdb/providers';
import { librarySubState } from '@/lib/libraryView';
import { isKeepReasonStatus } from '@/lib/spendSnapshot';
import type { WatchlistItem } from '@/types';

export interface WatchedForValue {
  // The owned service this title is attributed to (canonical id). Attribution
  // for multi-service titles is resolved by attributeProvider() below.
  providerId: number;
  // Title/episode runtime in minutes; null when unknown (counts toward the
  // title tally but not the hours, so kr/h stays honest).
  runtimeMinutes: number | null;
  watchedAtMs: number;
}

export interface ServiceValueRow {
  providerId: number;
  titlesWatched: number;
  minutesWatched: number;
  monthlyCost: number;
  // cost / titles — null when nothing was watched (avoid divide-by-zero).
  krPerTitle: number | null;
  // cost / hours — null when no runtime was logged.
  krPerHour: number | null;
  // Paid for, watched nothing this month → the drop candidate.
  isDeadWeight: boolean;
}

// Which owned service to credit a watched title to. A title can stream on
// several services; we attribute it to the cheapest-to-reason-about owned one
// (lowest canonical id — deterministic, documented). Returns null when the
// user owns none of the title's services (can't attribute → not counted).
export function attributeProvider(titleProviderIds: number[], ownedProviderIds: number[]): number | null {
  const owned = new Set(ownedProviderIds.map(canonicalProviderId));
  const candidates = titleProviderIds
    .map(canonicalProviderId)
    .filter((id) => owned.has(id));
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

// Build the WatchedForValue list from watchlist items: those watched within the
// month window and attributable to an owned service. Pure + testable; the hook
// wraps this + rollupServiceValue. NOTE: keys off `watchedAt`, which films get
// on 'sedd'. TV items carry no single watchedAt (episode times live in
// episodeProgress) — so this is a films-this-month lens; TV-episode hours are a
// separate follow-up aggregation.
export function watchedForValueFromItems(
  items: readonly { providers: number[]; runtime?: number | null; watchedAt: Date | null }[],
  ownedProviderIds: number[],
  monthStartMs: number,
  monthEndMs: number, // exclusive
): WatchedForValue[] {
  const out: WatchedForValue[] = [];
  for (const it of items) {
    if (!it.watchedAt) continue;
    const ms = it.watchedAt.getTime();
    if (ms < monthStartMs || ms >= monthEndMs) continue;
    const providerId = attributeProvider(it.providers, ownedProviderIds);
    if (providerId == null) continue;
    out.push({ providerId, runtimeMinutes: it.runtime ?? null, watchedAtMs: ms });
  }
  return out;
}

// BIN-513 (xhigh review 2026-07-16): the owned-provider ids that carry ACTIVE TV
// usage — a followed/will-see series that still gives a reason to keep the
// service. A fully-watched Ended/Canceled series (derived sub-state 'avslutad')
// is NOT active use: nothing new is coming, so it must stay eligible for the
// dead-weight verdict and is excluded here. Uses the persisted-fields-only
// librarySubState (no extra TMDB fan-out); a finished show whose tmdbStatus
// hasn't lazy-backfilled reads as 'paborjad' and is conservatively left shielded.
export function tvActiveProviderIdsFromItems(items: readonly WatchlistItem[]): number[] {
  const out: number[] = [];
  for (const it of items) {
    if (it.mediaType !== 'tv') continue;
    if (!isKeepReasonStatus(it.status)) continue; // shared BIN-528 guard
    if (librarySubState(it) === 'avslutad') continue;
    for (const p of it.providers ?? []) out.push(p);
  }
  return out;
}

export function rollupServiceValue(params: {
  watched: WatchedForValue[];
  ownedProviderIds: number[];
  costFor: (providerId: number) => number;
  monthStartMs: number;
  monthEndMs: number; // exclusive
  // BIN-513: canonical(-or-alias) ids of owned services carrying active TV usage
  // (a followed series / TV will-see anchor). This rollup is a films-this-month
  // lens — it keys off `watchedAt`, which only films get — so a service used
  // purely for TV shows zero titlesWatched and would be mislabelled dead weight.
  // Suppress the false verdict here; a full TV-hours rollup remains a follow-up.
  tvActiveProviderIds?: number[];
}): ServiceValueRow[] {
  const { watched, ownedProviderIds, costFor, monthStartMs, monthEndMs } = params;
  const tvActive = new Set((params.tvActiveProviderIds ?? []).map(canonicalProviderId));

  // One row per owned service (deduped on canonical id), seeded at zero so a
  // service nobody watched still shows up as dead-weight.
  const rows = new Map<number, ServiceValueRow>();
  for (const raw of ownedProviderIds) {
    const id = canonicalProviderId(raw);
    if (rows.has(id)) continue;
    rows.set(id, {
      providerId: id,
      titlesWatched: 0,
      minutesWatched: 0,
      monthlyCost: costFor(id),
      krPerTitle: null,
      krPerHour: null,
      isDeadWeight: false,
    });
  }

  for (const w of watched) {
    if (w.watchedAtMs < monthStartMs || w.watchedAtMs >= monthEndMs) continue;
    const id = canonicalProviderId(w.providerId);
    const row = rows.get(id);
    if (!row) continue; // not an owned service → not attributable
    row.titlesWatched += 1;
    if (w.runtimeMinutes != null && w.runtimeMinutes > 0) {
      row.minutesWatched += w.runtimeMinutes;
    }
  }

  for (const row of rows.values()) {
    row.krPerTitle = row.titlesWatched > 0
      ? Math.round(row.monthlyCost / row.titlesWatched)
      : null;
    row.krPerHour = row.minutesWatched > 0
      ? Math.round(row.monthlyCost / (row.minutesWatched / 60))
      : null;
    // Dead weight = paid for, watched no FILM this month AND not carrying any
    // active TV usage (BIN-513) — otherwise a TV-only service reads as wasted.
    row.isDeadWeight = row.titlesWatched === 0 && row.monthlyCost > 0 && !tvActive.has(row.providerId);
  }

  // Deterministic order: ascending canonical id.
  return Array.from(rows.values()).sort((a, b) => a.providerId - b.providerId);
}
