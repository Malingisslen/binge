// functions/src/streamingOffers/logic.ts
import type { IntentItem, ExistingOffer, HealthDoc, HealthStatus } from './types';

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
  if (!Array.isArray(item.providers) || item.providers.length === 0) return false;
  if (item.mediaType === 'movie') return item.status === 'vill_se';
  if (item.mediaType === 'tv') return item.status === 'mina';
  return false;
}

export function dedupeIntent(
  items: IntentItem[],
): { tmdbId: number; mediaType: 'movie' | 'tv' }[] {
  const seen = new Map<number, 'movie' | 'tv'>();
  for (const it of items) {
    if (!seen.has(it.tmdbId)) {
      seen.set(it.tmdbId, it.mediaType === 'tv' ? 'tv' : 'movie');
    }
  }
  return [...seen.entries()].map(([tmdbId, mediaType]) => ({ tmdbId, mediaType }));
}

/**
 * Order the work set into a refresh priority and take the top `budget`:
 *   1. never-checked (no existing doc)
 *   2. leaving within NEAR_EXPIRY_DAYS (re-confirm before it goes)
 *   3. stalest checkedAt
 */
export function selectRefreshBatch(
  workSet: { tmdbId: number; mediaType: 'movie' | 'tv' }[],
  existing: ExistingOffer[],
  nowMs: number,
  budget: number,
): number[] {
  const byId = new Map(existing.map((e) => [e.tmdbId, e]));
  const tier = (tmdbId: number): number => {
    const e = byId.get(tmdbId);
    if (!e) return 0; // never checked
    if (e.nextLeaving) {
      const delta = Date.parse(e.nextLeaving) - nowMs;
      // Only tier-1 if leaving is UPCOMING (delta >= 0) and within the near-expiry window.
      // Already-expired (negative delta) fall through to tier-2 (stalest-first) — not priority.
      if (delta >= 0 && delta <= NEAR_EXPIRY_DAYS * DAY_MS) return 1;
    }
    return 2;
  };
  const sortKey = (tmdbId: number): number => byId.get(tmdbId)?.checkedAt ?? 0;

  return [...workSet]
    .sort((a, b) => {
      const ta = tier(a.tmdbId);
      const tb = tier(b.tmdbId);
      if (ta !== tb) return ta - tb;            // lower tier first
      return sortKey(a.tmdbId) - sortKey(b.tmdbId); // older checkedAt first
    })
    .slice(0, budget)
    .map((x) => x.tmdbId);
}

export function computeHealth(workSetSize: number, budget: number, nowIso: string): HealthDoc {
  // Use MAX_SAFE_INTEGER instead of Infinity: Firestore rejects Infinity/NaN as field values.
  const refreshIntervalDays = budget > 0 ? Math.ceil(workSetSize / budget) : Number.MAX_SAFE_INTEGER;
  let status: HealthStatus = 'ok';
  if (refreshIntervalDays > CRITICAL_DAYS) status = 'critical';
  else if (refreshIntervalDays > WARN_DAYS) status = 'warn';
  return { computedAt: nowIso, workSetSize, dailyBudget: budget, refreshIntervalDays, status };
}
