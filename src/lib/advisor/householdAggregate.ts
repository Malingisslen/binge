// BIN-184 — "Hushåll": pure aggregation over opted-in group members' self-written
// subscription contributions (groups/{gid}/household/{uid}). Client-side only —
// no Cloud Function, no denormalized totals (DPO must-have: a revoked member's
// number can never linger in a stored rollup; everything is recomputed from the
// live contribution set at render).
//
// Contribution persistence contract (panel review 2026-07-05, ADR 0010):
//  - providerCosts holds the member's ORDINARY price per provider, resolved at
//    WRITE time (tier → custom → catalog default) — tier NAMES never leave the
//    member's device (DPO minimization: "Familj"/"Student" is excess disclosure).
//  - providerCampaigns stays RAW ({monthlyCost, endDate}, BIN-417 contract) so a
//    lapsed promo auto-reverts in the household view at READ time even while the
//    contributor is away. Resolution here always uses the single injected `now`.
//  - activeProviderIds is provider-level only (never title/genre-level).
//
// Honesty rules (role #28 must-haves, all tested):
//  - Cross-member canonical merge: alias ids (531 Paramount+ / 431 SkyShowtime)
//    land on ONE row with paidByCount 2 — never two rows of 1. Applies to cost
//    and campaign map keys AND activeProviderIds, not just providerIds.
//  - Unknown cost is never silently 0: it is excluded from totalKr but still
//    counted in paidByCount-adjacent `unknownCostCount` and flagged on the row.
//  - Free/ads (0 kr effective for every sharer) never appear as spend rows and
//    are never dead-weight (nothing "wasted" that costs nothing).
//  - Stale evidence never convicts: a contribution older than
//    HOUSEHOLD_STALE_DAYS makes "ingen i hushållet har backlog på X" unprovable,
//    so such rows get activityUnknown instead of deadWeight. Fresh positive
//    activity clears a row individually regardless of others' staleness.
//  - The double-counted household total is DELIBERATE ("Disney+ betalas av 2 av
//    er" is the insight). There is intentionally NO savings/sharing-suggestion
//    field in the output shape — account-sharing implications are out of scope
//    (ADR 0010: copy stays silent).

import { canonicalProviderId, canonicalUniqueProviders, getProvider, resolveProviderMonthlyCost } from '@/lib/tmdb/providers';
import { resolveCampaignCost, type ProviderCampaign } from '@/lib/advisor/campaignPricing';
import { isKeepReasonStatus } from '@/lib/spendSnapshot';
import type { WatchlistItem } from '@/types';

/** Contribution shape as consumed here — plain data, Firestore Timestamp already
 *  converted to epoch ms by the subscriber (null = missing/unreadable). */
export interface HouseholdContribution {
  uid: string;
  providerIds: number[];
  providerCosts: Record<number, number>;
  providerCampaigns: Record<number, ProviderCampaign>;
  activeProviderIds: number[];
  updatedAt: number | null;
}

export interface HouseholdProviderRow {
  /** Canonical provider id. */
  providerId: number;
  name: string;
  /** Members paying a known, >0 kr effective price for this service. */
  paidByCount: number;
  /** Members sharing this service whose cost could not be resolved (never 0-coerced). */
  unknownCostCount: number;
  /** Members on this service at 0 kr effective (free/ads or self-zeroed) — not spend.
   *  Named to avoid the ADR-0010 output-field guard (no 'shar'/'saving' keys): this
   *  is a descriptive zero-cost tally, never an account-sharing suggestion. */
  zeroCostCount: number;
  /** Sum of the KNOWN effective monthly costs (duplicates deliberately add up). */
  totalKr: number;
  /** A FRESH contribution has this provider in its backlog (positive evidence). */
  anyActive: boolean;
  /** Paid by ≥1, and every contribution is fresh, and none is active — honest dead weight. */
  deadWeight: boolean;
  /** No fresh activity, but ≥1 contribution is too old to trust — verdict withheld. */
  activityUnknown: boolean;
}

export interface HouseholdOverview {
  /** Number of opted-in contributions aggregated. */
  memberCount: number;
  /** Contributions older than the staleness window (or missing updatedAt). */
  staleCount: number;
  /** Household monthly spend across all known costs (double-counting intended). */
  totalKr: number;
  /** Total member×provider pairs whose cost is unknown (excluded from totalKr). */
  unknownCostCount: number;
  /** Spend rows (≥1 payer or unknown-cost sharer), totalKr desc. */
  rows: HouseholdProviderRow[];
  /** Convenience subset of rows where deadWeight is true. */
  deadWeight: HouseholdProviderRow[];
  /** Oldest contribution timestamp (ms) — the UI's "senast uppdaterad" honesty stamp. */
  oldestUpdatedAt: number | null;
}

/** Contributions older than this are "unknown", not "inactive", for dead-weight. */
export const HOUSEHOLD_STALE_DAYS = 30;

const DAY_MS = 86_400_000;

function isFresh(updatedAt: number | null, nowMs: number): boolean {
  if (updatedAt == null) return false;
  return nowMs - updatedAt <= HOUSEHOLD_STALE_DAYS * DAY_MS;
}

/** Canonicalise a member's number-keyed map, preferring an entry already keyed by
 *  the canonical id over an alias-keyed one when both exist. */
function canonicalMap<T>(map: Record<number, T> | undefined): Map<number, T> {
  const out = new Map<number, T>();
  if (!map) return out;
  for (const [k, v] of Object.entries(map)) {
    const raw = Number(k);
    const canon = canonicalProviderId(raw);
    // Canonical-keyed entry wins; an alias entry only fills an empty slot.
    if (raw === canon || !out.has(canon)) out.set(canon, v);
  }
  return out;
}

/**
 * Aggregate opted-in members' contributions into the household overview.
 * `now` is REQUIRED and injected (never defaulted): campaign expiry must resolve
 * deterministically at read time — a lapsed promo reverts to the member's
 * ordinary price here no matter how old their contribution doc is.
 */
export function aggregateHousehold(
  contributions: readonly HouseholdContribution[],
  now: Date,
): HouseholdOverview {
  const nowMs = now.getTime();

  interface Acc {
    paidByCount: number;
    unknownCostCount: number;
    totalKr: number;
    anyActive: boolean;      // fresh positive evidence only
    anyStaleSharer: boolean; // some sharer's contribution is stale
    freeSharerCount: number; // sharers whose known effective cost is 0 (free/ads)
  }
  const acc = new Map<number, Acc>();
  const anyStaleContribution = contributions.some(c => !isFresh(c.updatedAt, nowMs));

  let staleCount = 0;
  let oldestUpdatedAt: number | null = null;

  for (const c of contributions) {
    const fresh = isFresh(c.updatedAt, nowMs);
    if (!fresh) staleCount += 1;
    if (c.updatedAt != null && (oldestUpdatedAt == null || c.updatedAt < oldestUpdatedAt)) {
      oldestUpdatedAt = c.updatedAt;
    }

    const shared = [...new Set((c.providerIds ?? []).map(canonicalProviderId))];
    const costs = canonicalMap(c.providerCosts);
    const campaigns = canonicalMap(c.providerCampaigns);
    const active = new Set((c.activeProviderIds ?? []).map(canonicalProviderId));

    for (const id of shared) {
      let a = acc.get(id);
      if (!a) {
        a = { paidByCount: 0, unknownCostCount: 0, totalKr: 0, anyActive: false, anyStaleSharer: false, freeSharerCount: 0 };
        acc.set(id, a);
      }
      if (!fresh) a.anyStaleSharer = true;
      if (fresh && active.has(id)) a.anyActive = true;

      const ordinary = costs.get(id);
      if (ordinary == null || !Number.isFinite(ordinary)) {
        // Unknown cost: surfaced, never coerced to 0 (a campaign alone can't
        // invent a price — same contract as resolveEffectiveMonthlyCost).
        a.unknownCostCount += 1;
        continue;
      }
      const effective = resolveCampaignCost(campaigns.get(id), ordinary, now).effectiveMonthlyCost;
      if (effective > 0) {
        a.paidByCount += 1;
        a.totalKr += effective;
      } else {
        a.freeSharerCount += 1; // free/ads or user-zeroed — not spend
      }
    }
  }

  // Fresh members can be active on services they don't pay for (family viewing) —
  // that positive evidence must still clear the payer's row.
  for (const c of contributions) {
    if (!isFresh(c.updatedAt, nowMs)) continue;
    for (const rawId of c.activeProviderIds ?? []) {
      const a = acc.get(canonicalProviderId(rawId));
      if (a) a.anyActive = true;
    }
  }

  const rows: HouseholdProviderRow[] = [];
  for (const [id, a] of acc) {
    // Free-only services (SVT Play) are not spend and don't belong in a cost view.
    if (a.paidByCount === 0 && a.unknownCostCount === 0) continue;
    const noFreshActivity = !a.anyActive;
    // "Nobody in the household uses this" needs EVERY contribution fresh — any
    // stale member (sharer or not) could be the unseen watcher.
    const evidenceComplete = !anyStaleContribution;
    rows.push({
      providerId: id,
      name: getProvider(id)?.name ?? `Tjänst ${id}`,
      paidByCount: a.paidByCount,
      unknownCostCount: a.unknownCostCount,
      zeroCostCount: a.freeSharerCount,
      totalKr: a.totalKr,
      anyActive: a.anyActive,
      deadWeight: a.paidByCount > 0 && noFreshActivity && evidenceComplete,
      activityUnknown: a.paidByCount > 0 && noFreshActivity && !evidenceComplete,
    });
  }
  rows.sort((x, y) => y.totalKr - x.totalKr || x.providerId - y.providerId);

  return {
    memberCount: contributions.length,
    staleCount,
    totalKr: rows.reduce((s, r) => s + r.totalKr, 0),
    unknownCostCount: rows.reduce((s, r) => s + r.unknownCostCount, 0),
    rows,
    deadWeight: rows.filter(r => r.deadWeight),
    oldestUpdatedAt,
  };
}

/** The write-side payload — everything except uid (doc id) and updatedAt (server). */
export type HouseholdContributionContent = Omit<HouseholdContribution, 'uid' | 'updatedAt'>;

/**
 * Build the member's own contribution from their profile fields + watchlist.
 * This is the ONLY place the shared payload is derived, and it enforces the
 * minimization contract at the source:
 *  - tier choices are resolved to a plain ordinary kr figure HERE (tier →
 *    custom → catalog default); the tier NAME never enters the payload (DPO).
 *  - a provider with no resolvable ordinary price is OMITTED from providerCosts
 *    (readers count it as unknown — never a fabricated 0).
 *  - campaigns are copied RAW, only for shared providers (read-time resolution).
 *  - activeProviderIds = providers carrying ≥1 backlog title (vill_se/mina),
 *    same derivation as computeSpendSnapshot — provider-level only.
 * Everything is canonicalised at write so alias ids never reach the group doc.
 */
export function buildHouseholdContribution(
  myProviders: number[],
  providerCosts: Record<number, number>,
  providerTiers: Record<number, string>,
  providerCampaigns: Record<number, ProviderCampaign>,
  items: readonly Pick<WatchlistItem, 'status' | 'providers'>[],
): HouseholdContributionContent {
  const providerIds = canonicalUniqueProviders(myProviders);

  const costs: Record<number, number> = {};
  const campaigns: Record<number, ProviderCampaign> = {};
  for (const id of providerIds) {
    const ordinary = resolveProviderMonthlyCost(id, { providerTiers, providerCosts });
    if (ordinary != null) costs[id] = ordinary;
    // User maps are canonical-keyed (BIN-417 contract) — plain lookup suffices.
    const campaign = providerCampaigns[id];
    if (campaign) campaigns[id] = { monthlyCost: campaign.monthlyCost, endDate: campaign.endDate };
  }

  const active = new Set<number>();
  for (const it of items) {
    if (!isKeepReasonStatus(it.status)) continue; // shared BIN-528 guard
    for (const p of it.providers ?? []) active.add(canonicalProviderId(p));
  }

  return {
    providerIds,
    providerCosts: costs,
    providerCampaigns: campaigns,
    activeProviderIds: [...active].sort((a, b) => a - b),
  };
}

/**
 * Content equality for the dirty-check (DBA must-have): the fan-out and the
 * visit-refresh both skip the Firestore write when nothing changed, so a member
 * who opens the group page daily doesn't write daily against the 25 SEK cap.
 * Order-insensitive on the id lists; strict on map entries.
 */
export function contributionContentEquals(
  a: HouseholdContributionContent,
  b: HouseholdContributionContent,
): boolean {
  const sameList = (x: number[], y: number[]): boolean => {
    if (x.length !== y.length) return false;
    const xs = [...x].sort((p, q) => p - q);
    const ys = [...y].sort((p, q) => p - q);
    return xs.every((v, i) => v === ys[i]);
  };
  const sameNumMap = (x: Record<number, number>, y: Record<number, number>): boolean => {
    const xk = Object.keys(x);
    if (xk.length !== Object.keys(y).length) return false;
    return xk.every(k => y[Number(k)] === x[Number(k)]);
  };
  const sameCampaigns = (x: Record<number, ProviderCampaign>, y: Record<number, ProviderCampaign>): boolean => {
    const xk = Object.keys(x);
    if (xk.length !== Object.keys(y).length) return false;
    return xk.every(k => {
      const cx = x[Number(k)];
      const cy = y[Number(k)];
      return cy != null && cx.monthlyCost === cy.monthlyCost && cx.endDate === cy.endDate;
    });
  };
  return (
    sameList(a.providerIds, b.providerIds) &&
    sameList(a.activeProviderIds, b.activeProviderIds) &&
    sameNumMap(a.providerCosts, b.providerCosts) &&
    sameCampaigns(a.providerCampaigns, b.providerCampaigns)
  );
}
