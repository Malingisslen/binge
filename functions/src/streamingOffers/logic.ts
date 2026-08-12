// functions/src/streamingOffers/logic.ts
import { mediaTypeDocId, normalizeMediaType, type MediaType } from '../shared/mediaTypeDocId';
import type { IntentItem, ExistingOffer, WorkItem, HealthDoc, HealthStatus, DeliveryState, RunOutcome } from './types';

/**
 * Doc id for the shared streamingOffers document (BIN-523). Movie N and TV N
 * are unrelated titles, so the primary offers doc is namespaced by media type
 * exactly like availableNotifyState.
 *
 * LEGACY bare-`${tmdbId}` docs are NOT migrated or deleted. Both readers
 * (src/hooks/useStreamingOffers.ts and weeklyDigest's readOffers) fall back to
 * the bare id and accept it only when its stored `mediaType` field matches what
 * they asked for — so a title keeps showing its last known offers until the
 * refresh cron rewrites it under the namespaced id. Rewriting the collection
 * eagerly would spend MOTN quota (the scarce resource) for zero user value.
 */
export function streamingOffersDocId(mediaType: string, tmdbId: number): string {
  return mediaTypeDocId(mediaType, tmdbId);
}

const NEAR_EXPIRY_DAYS = 5;
// BIN-541 code review (2026-07-17): these used to be calibrated against the
// ~85-95/day budget from when the vendor cap was believed to reset daily.
// PER_RUN_SELECT is now 9 (paced to survive a whole ~31-day billing cycle —
// see streamingOffers/index.ts), so the "how many days to fully refresh the
// library" metric this feeds needs its own thresholds tied to the NEW model:
// warn once a full pass can't complete within one billing cycle (worth
// watching), critical once it can't complete within two (seriously stale,
// time to consider MOTN Pro). Not re-tuning these after the budget cut ~89%
// would trip 'critical' near-permanently at realistic future library sizes
// even though the system is behaving exactly as designed.
const WARN_DAYS = 31;
const CRITICAL_DAYS = 62;
const DAY_MS = 86_400_000;

/** A title is "intent" iff: film in vill_se OR tv in mina, AND currently on a provider. */
export function isIntentTitle(item: IntentItem): boolean {
  // BIN-856: an unusable id is not an intent title. `resolveTmdbId` yields NaN
  // when the field is non-numeric AND the doc id has no digits-only suffix —
  // the watchlist rules whitelist the `tmdbId` key without binding its type,
  // so a client can write one. Such an item can never be fetched, and because
  // readExisting skips it, it never gains a `checkedAt` and never leaves tier 0
  // ("never checked", always sorted first) — so it would be re-picked on EVERY
  // run forever, spending a reserved vendor call each time. The guard lives
  // here rather than at the call site so it is covered by logic.test.ts;
  // index.ts imports firebase-admin and cannot be unit-tested.
  if (!Number.isFinite(item.tmdbId)) return false;
  if (!Array.isArray(item.providers) || item.providers.length === 0) return false;
  if (item.mediaType === 'movie') return item.status === 'vill_se';
  if (item.mediaType === 'tv') return item.status === 'mina';
  return false;
}

/**
 * Collapse the same title tracked by many users into one work item.
 *
 * BIN-545: this used to key on bare tmdbId, so a movie and a TV show sharing a
 * TMDB numeric id collapsed into ONE entry. Combined with the caller's
 * `orderBy('status')` scan the winner was deterministic, not random — the same
 * media type won every single run, permanently excluding the other one from
 * refresh. Keyed on (mediaType, tmdbId) both now get their own entry.
 */
export function dedupeIntent(items: IntentItem[]): WorkItem[] {
  const seen = new Map<string, WorkItem>();
  for (const it of items) {
    // Use the shared normalizer rather than a local ternary with the OPPOSITE
    // default — a writer and its readers disagreeing about where an unknown
    // media type lives is the exact drift the shared helper exists to prevent.
    // Behaviour-neutral on real traffic: isIntentTitle has already rejected
    // anything that isn't exactly 'movie'/'tv', so this only guards direct
    // callers and tests.
    const mediaType: MediaType = normalizeMediaType(it.mediaType);
    const key = mediaTypeDocId(mediaType, it.tmdbId);
    if (!seen.has(key)) seen.set(key, { tmdbId: it.tmdbId, mediaType });
  }
  return [...seen.values()];
}

/**
 * Order the work set into a refresh priority and take the top `budget`:
 *   1. never-checked (no existing doc)
 *   2. leaving within NEAR_EXPIRY_DAYS (re-confirm before it goes)
 *   3. stalest checkedAt
 *
 * BIN-523: both sides are matched on (mediaType, tmdbId) — pairing movie N's
 * work item with TV N's existing doc would report the wrong staleness and could
 * starve one of the two of refreshes.
 */
export function selectRefreshBatch(
  workSet: WorkItem[],
  existing: ExistingOffer[],
  nowMs: number,
  budget: number,
): WorkItem[] {
  // During the id-scheme transition a title can have BOTH a legacy bare-id doc
  // and a new namespaced one. Keep the freshest so a stale leftover can't drag a
  // just-refreshed title back to the front of the queue (BIN-523).
  const byKey = new Map<string, ExistingOffer>();
  for (const e of existing) {
    const key = mediaTypeDocId(e.mediaType, e.tmdbId);
    const prev = byKey.get(key);
    if (!prev || e.checkedAt > prev.checkedAt) byKey.set(key, e);
  }
  const tier = (w: WorkItem): number => {
    const e = byKey.get(mediaTypeDocId(w.mediaType, w.tmdbId));
    if (!e) return 0; // never checked
    if (e.nextLeaving) {
      const delta = Date.parse(e.nextLeaving) - nowMs;
      // Only tier-1 if leaving is UPCOMING (delta >= 0) and within the near-expiry window.
      // Already-expired (negative delta) fall through to tier-2 (stalest-first) — not priority.
      if (delta >= 0 && delta <= NEAR_EXPIRY_DAYS * DAY_MS) return 1;
    }
    return 2;
  };
  const sortKey = (w: WorkItem): number => byKey.get(mediaTypeDocId(w.mediaType, w.tmdbId))?.checkedAt ?? 0;

  return [...workSet]
    .sort((a, b) => {
      const ta = tier(a);
      const tb = tier(b);
      if (ta !== tb) return ta - tb;    // lower tier first
      return sortKey(a) - sortKey(b);   // older checkedAt first
    })
    .slice(0, budget);
}

// BIN-856 (2026-08-12, Malin's option B). The job runs daily, so one empty run
// is a network blip and must not wake her; two in a row is a real signal. Had
// this existed on 2026-07-11 it would have warned on the 13th instead of
// letting a total outage run for a month under a green "ok".
const FEED_WARN_RUNS = 2;
const FEED_CRITICAL_RUNS = 4;

/**
 * What one run proved about the feed.
 *
 * The distinction that matters — and the one the previous per-run signal
 * collapsed — is between "we made no vendor calls" and "we made nine and every
 * one failed". Both used to be `no_signal`; the second is the state that ran
 * unnoticed for a month.
 *
 * `inconclusive` is deliberately generous. A run that asked nothing (empty
 * batch, or the budget denied before the first call) proves nothing, and being
 * rate-limited is a normal end-of-cycle condition that already has its own
 * admin alarm — counting either as a failure would cry wolf. Data that arrived
 * BEFORE a 429 still counts as delivered: the feed demonstrably works.
 */
export function classifyRunOutcome(attempted: number, sawClean: boolean, sawRateLimited: boolean): RunOutcome {
  if (sawClean) return 'delivered';
  if (sawRateLimited) return 'inconclusive';
  return attempted > 0 ? 'no-delivery' : 'inconclusive';
}

/**
 * Only a real delivery clears the streak. An `inconclusive` run must leave it
 * exactly where it was: resetting on "nothing to do" would let a feed that
 * alternates broken and idle never reach the alarm at all.
 */
export function nextRunsWithoutSuccess(prev: number, outcome: RunOutcome): number {
  if (outcome === 'delivered') return 0;
  if (outcome === 'no-delivery') return prev + 1;
  return prev;
}

/** How bad the delivery side looks, from the consecutive-empty-run count. */
export function feedStatusFor(runsWithoutSuccess: number): HealthStatus {
  if (runsWithoutSuccess >= FEED_CRITICAL_RUNS) return 'critical';
  if (runsWithoutSuccess >= FEED_WARN_RUNS) return 'warn';
  return 'ok';
}

const SEVERITY: Record<HealthStatus, number> = { ok: 0, warn: 1, critical: 2 };

/** The more severe of two statuses. */
export function worstStatus(a: HealthStatus, b: HealthStatus): HealthStatus {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

/**
 * BIN-856: `status` is now the WORSE of two independent questions —
 *
 *  - **capacity**: can we cycle the library often enough? (library size ÷ the
 *    per-run budget; the whole of what `status` used to mean)
 *  - **delivery**: is data actually arriving? (`delivery.runsWithoutSuccess`)
 *
 * The old calculation could not fail. Both its inputs are the library size and
 * a constant, so a vendor returning 400 to every single call for a month left
 * it reading a comfortable "ok" — which is exactly what happened. Keeping the
 * two sub-statuses on the document as well means a red status can say WHICH
 * half went wrong, and the two feed different admin messages: telling her to
 * consider a paid plan because the feed is broken would be the wrong advice.
 */
export function computeHealth(
  workSetSize: number,
  budget: number,
  nowIso: string,
  delivery: DeliveryState,
): HealthDoc {
  // Use MAX_SAFE_INTEGER instead of Infinity: Firestore rejects Infinity/NaN as field values.
  const refreshIntervalDays = budget > 0 ? Math.ceil(workSetSize / budget) : Number.MAX_SAFE_INTEGER;
  let capacityStatus: HealthStatus = 'ok';
  if (refreshIntervalDays > CRITICAL_DAYS) capacityStatus = 'critical';
  else if (refreshIntervalDays > WARN_DAYS) capacityStatus = 'warn';

  const feedStatus = feedStatusFor(delivery.runsWithoutSuccess);
  return {
    computedAt: nowIso,
    workSetSize,
    dailyBudget: budget,
    refreshIntervalDays,
    status: worstStatus(capacityStatus, feedStatus),
    capacityStatus,
    feedStatus,
    ...delivery,
  };
}
