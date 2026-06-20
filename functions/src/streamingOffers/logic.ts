// functions/src/streamingOffers/logic.ts
import type { IntentItem, ExistingOffer, HealthDoc, HealthStatus } from './types';

const NEAR_EXPIRY_DAYS = 5;
const WARN_DAYS = 14;
const CRITICAL_DAYS = 21;
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
    if (e.nextLeaving && Date.parse(e.nextLeaving) - nowMs <= NEAR_EXPIRY_DAYS * DAY_MS) return 1;
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
  const refreshIntervalDays = budget > 0 ? Math.ceil(workSetSize / budget) : Infinity;
  let status: HealthStatus = 'ok';
  if (refreshIntervalDays > CRITICAL_DAYS) status = 'critical';
  else if (refreshIntervalDays > WARN_DAYS) status = 'warn';
  return { computedAt: nowIso, workSetSize, dailyBudget: budget, refreshIntervalDays, status };
}
