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
//    er" is the insight). The saving figures live in householdVerdicts.ts, not in
//    this output shape.

import { subscriptionProviderIds } from '@/lib/watchlist/subscriptionProviders';
import { canonicalProviderId, canonicalUniqueProviders, getProvider, resolveProviderMonthlyCost } from '@/lib/tmdb/providers';
import { resolveCampaignCost, type ProviderCampaign } from '@/lib/advisor/campaignPricing';
import { isKeepReasonStatus } from '@/lib/spendSnapshot';
import type { WatchlistItem } from '@/types';

/** A member's monthly say on one household service (ADR 0026). */
export const HOUSEHOLD_VOTES = ['ok', 'keep', 'wait'] as const;
export type HouseholdVote = (typeof HOUSEHOLD_VOTES)[number];

/** Contribution shape as consumed here — plain data, Firestore Timestamp already
 *  converted to epoch ms by the subscriber (null = missing/unreadable). */
export interface HouseholdContribution {
  uid: string;
  providerIds: number[];
  providerCosts: Record<number, number>;
  providerCampaigns: Record<number, ProviderCampaign>;
  activeProviderIds: number[];
  /** Providers with something new within HOUSEHOLD_SOON_DAYS. Absent (undefined) means the
   *  member shared before this field existed and has not re-shared: unknown, never "nothing". */
  soonProviderIds?: number[];
  /** Absent when the member has not voted. Only meaningful when votesMonth is the current month. */
  votes?: Record<number, HouseholdVote>;
  votesMonth?: string;
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

function isFresh(updatedAt: number | null, nowMs: number, maxAgeDays: number = HOUSEHOLD_STALE_DAYS): boolean {
  if (updatedAt == null) return false;
  return nowMs - updatedAt <= maxAgeDays * DAY_MS;
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

/** The part rebuilt from the member's own profile and watchlist on every write. */
export type HouseholdBaseContent = Pick<
  HouseholdContributionContent,
  'providerIds' | 'providerCosts' | 'providerCampaigns' | 'activeProviderIds'
>;

// ── Votes and the "nytt inom 30 dagar" flag (ADR 0026) ───────────────────────
// The rules cannot validate each entry of the votes map without a loop, so the
// client validates before every write and every reader drops what it does not
// recognise: an unknown value or key counts as no vote, never as a vote.

export function isHouseholdVote(value: unknown): value is HouseholdVote {
  return typeof value === 'string' && (HOUSEHOLD_VOTES as readonly string[]).includes(value);
}

/** Provider ids are TMDB integers; anything else is not a votable key. */
export function isHouseholdProviderId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

const stockholmMonth = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
});

/** "YYYY-MM" for `now` in Swedish time. Votes are a monthly decision for a Swedish
 *  household, so the month turns at Stockholm midnight, not at UTC midnight. */
export function householdVoteMonthKey(now: Date): string {
  const parts = stockholmMonth.formatToParts(now);
  const year = parts.find(p => p.type === 'year')?.value ?? '';
  const month = parts.find(p => p.type === 'month')?.value ?? '';
  return `${year}-${month}`;
}

/** Read-side sanitiser for a stored soonProviderIds value. A missing or non-list value
 *  stays undefined (unknown); non-integer entries are dropped. */
export function sanitizeSoonProviderIds(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter(isHouseholdProviderId);
}

/** Read-side sanitiser for a stored votes map: keeps only integer keys with a known value. */
export function sanitizeVotes(raw: unknown): Record<number, HouseholdVote> | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<number, HouseholdVote> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(k);
    if (isHouseholdProviderId(id) && String(id) === k && isHouseholdVote(v)) out[id] = v;
  }
  return out;
}

export function sanitizeVotesMonth(raw: unknown): string | undefined {
  return typeof raw === 'string' && MONTH_KEY_RE.test(raw) ? raw : undefined;
}

/** The member's votes that count this month, canonical-keyed. Votes from an earlier
 *  month are ignored, not deleted: they are overwritten by the next write. */
export function currentHouseholdVotes(
  c: Pick<HouseholdContribution, 'votes' | 'votesMonth'>,
  monthKey: string,
): Map<number, HouseholdVote> {
  const out = new Map<number, HouseholdVote>();
  if (c.votesMonth !== monthKey || !c.votes) return out;
  for (const [k, v] of Object.entries(c.votes)) {
    const raw = Number(k);
    if (!isHouseholdProviderId(raw) || !isHouseholdVote(v)) continue;
    const canon = canonicalProviderId(raw);
    if (raw === canon || !out.has(canon)) out.set(canon, v);
  }
  return out;
}

/** Window for "något nytt": the same 30 days the advisor uses for an active service. */
export const HOUSEHOLD_SOON_DAYS = 30;

function localDayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Providers where the member has something new within HOUSEHOLD_SOON_DAYS, from the
 * denormalised `nextAirDate` already stored on each watchlist row (no TMDB fetch).
 * Provider ids only: no title, date or count leaves the device. Same backlog and
 * subscription-subset rules as activeProviderIds.
 */
export function buildSoonProviderIds(
  items: readonly Pick<WatchlistItem, 'status' | 'providers' | 'subscriptionProviders' | 'nextAirDate' | 'dropped' | 'visibility'>[],
  today: Date,
): number[] {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + HOUSEHOLD_SOON_DAYS);
  const startKey = localDayKey(start);
  const endKey = localDayKey(end);
  const soon = new Set<number>();
  for (const it of items) {
    if (it.dropped || !isKeepReasonStatus(it.status) || it.visibility === 'private') continue;
    const date = it.nextAirDate;
    if (!date || date < startKey || date > endKey) continue;
    for (const p of subscriptionProviderIds(it)) soon.add(canonicalProviderId(p));
  }
  return [...soon].sort((a, b) => a - b);
}

/**
 * Compose the member's next contribution from a freshly built base, carrying what the
 * base cannot know:
 *  - soonProviderIds is written ONLY when the member already re-shared under the consent
 *    copy that names it (the existing doc carries the field) or `optInSoon` is set by the
 *    Dela press itself. `soon` is the fresh value; when null (no watchlist in this layer)
 *    the existing value is kept.
 *  - votes from the current month are kept; older ones are dropped here.
 */
export function composeHouseholdContribution(
  base: HouseholdBaseContent,
  existing: Pick<HouseholdContribution, 'soonProviderIds' | 'votes' | 'votesMonth'> | undefined,
  opts: { monthKey: string; soon: number[] | null; optInSoon?: boolean },
): HouseholdContributionContent {
  const out: HouseholdContributionContent = { ...base };
  const soonShared = opts.optInSoon === true || existing?.soonProviderIds !== undefined;
  if (soonShared) {
    const value = opts.soon ?? existing?.soonProviderIds;
    if (value !== undefined) out.soonProviderIds = value;
  }
  const votes = existing ? currentHouseholdVotes(existing, opts.monthKey) : new Map<number, HouseholdVote>();
  if (votes.size > 0) {
    out.votes = Object.fromEntries(votes) as Record<number, HouseholdVote>;
    out.votesMonth = opts.monthKey;
  }
  return out;
}

function withoutVotes<T extends HouseholdContributionContent>(c: T): T {
  const out = { ...c };
  delete out.votes;
  delete out.votesMonth;
  return out;
}

/**
 * Set or clear one vote on a composed contribution. Returns null when the provider id or
 * the vote is not valid, so a caller can never write an unvalidated value.
 */
export function applyHouseholdVote(
  content: HouseholdContributionContent,
  monthKey: string,
  providerId: number,
  vote: HouseholdVote | null,
): HouseholdContributionContent | null {
  if (!isHouseholdProviderId(providerId)) return null;
  if (vote !== null && !isHouseholdVote(vote)) return null;
  const votes = currentHouseholdVotes(content, monthKey);
  const id = canonicalProviderId(providerId);
  if (vote === null) votes.delete(id);
  else votes.set(id, vote);
  const rest = withoutVotes(content);
  if (votes.size === 0) return rest;
  return { ...rest, votes: Object.fromEntries(votes) as Record<number, HouseholdVote>, votesMonth: monthKey };
}

/** Dirty-check against the stored own doc, where stale-month votes count as no votes:
 *  dropping them alone never costs a write. */
export function householdContributionNeedsWrite(
  next: HouseholdContributionContent,
  existing: HouseholdContribution,
  monthKey: string,
): boolean {
  const votes = currentHouseholdVotes(existing, monthKey);
  const rest: HouseholdContributionContent = withoutVotes(existing);
  const comparable: HouseholdContributionContent = votes.size > 0
    ? { ...rest, votes: Object.fromEntries(votes) as Record<number, HouseholdVote>, votesMonth: monthKey }
    : rest;
  return !contributionContentEquals(next, comparable);
}

/** A visit rewrites a shared soon flag older than this even when its content is unchanged,
 *  so a member who opens the app often never ages out of HOUSEHOLD_SOON_FRESH_DAYS. */
export const HOUSEHOLD_SOON_REFRESH_DAYS = 3;

export function householdSoonNeedsRefresh(
  existing: Pick<HouseholdContribution, 'soonProviderIds' | 'updatedAt'>,
  nowMs: number,
): boolean {
  return existing.soonProviderIds !== undefined && !isFresh(existing.updatedAt, nowMs, HOUSEHOLD_SOON_REFRESH_DAYS);
}

/** Below this many members with the flag, "N av M" is hidden: with two, each sees the other's answer. */
export const HOUSEHOLD_SOON_MIN_REPORTERS = 3;

/** A soon flag is a snapshot of [write, write + HOUSEHOLD_SOON_DAYS]; it is only rewritten
 *  when the member opens the app, so after a week most of that window has passed and
 *  "nothing new" can no longer be claimed from it. Shorter than HOUSEHOLD_STALE_DAYS on purpose. */
export const HOUSEHOLD_SOON_FRESH_DAYS = 7;

export interface HouseholdSoonOverview {
  /** Fresh contributions carrying the flag: the M in "N av M". */
  reportedCount: number;
  /** Contributions without the flag, or too old to trust: never counted as "nothing new". */
  unknownCount: number;
  /** False when reportedCount < HOUSEHOLD_SOON_MIN_REPORTERS; counts are then empty. */
  visible: boolean;
  /** Canonical provider id → N. Empty when not visible. */
  soonCountByProvider: Record<number, number>;
}

export function aggregateHouseholdSoon(
  contributions: readonly HouseholdContribution[],
  now: Date,
): HouseholdSoonOverview {
  const nowMs = now.getTime();
  let reportedCount = 0;
  let unknownCount = 0;
  const counts = new Map<number, number>();
  for (const c of contributions) {
    if (c.soonProviderIds === undefined || !isFresh(c.updatedAt, nowMs, HOUSEHOLD_SOON_FRESH_DAYS)) {
      unknownCount += 1;
      continue;
    }
    reportedCount += 1;
    const ids = new Set(c.soonProviderIds.filter(isHouseholdProviderId).map(canonicalProviderId));
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const visible = reportedCount >= HOUSEHOLD_SOON_MIN_REPORTERS;
  return {
    reportedCount,
    unknownCount,
    visible,
    soonCountByProvider: visible ? (Object.fromEntries(counts) as Record<number, number>) : {},
  };
}

export interface HouseholdVoteRow {
  providerId: number;
  /** One entry per member who voted this month; the UI joins uid to members/{uid}.displayName. */
  votes: { uid: string; vote: HouseholdVote }[];
  counts: Record<HouseholdVote, number>;
}

/** This month's votes per service, sorted by provider id, voters by uid. */
export function aggregateHouseholdVotes(
  contributions: readonly HouseholdContribution[],
  now: Date,
): HouseholdVoteRow[] {
  const monthKey = householdVoteMonthKey(now);
  const rows = new Map<number, HouseholdVoteRow>();
  for (const c of contributions) {
    for (const [id, vote] of currentHouseholdVotes(c, monthKey)) {
      let row = rows.get(id);
      if (!row) {
        row = { providerId: id, votes: [], counts: { ok: 0, keep: 0, wait: 0 } };
        rows.set(id, row);
      }
      row.votes.push({ uid: c.uid, vote });
      row.counts[vote] += 1;
    }
  }
  const out = [...rows.values()].sort((a, b) => a.providerId - b.providerId);
  for (const row of out) row.votes.sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  return out;
}

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
  // BIN-814: subscriptionProviders belongs in the Pick, not just providers — a
  // narrower row shape would fall back to the broad array and let a rentable title
  // shield a service from the dead-weight verdict.
  items: readonly Pick<WatchlistItem, 'status' | 'providers' | 'subscriptionProviders' | 'visibility'>[],
): HouseholdBaseContent {
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
    // A title the member marked Privat is the one way to keep a title out of the household.
    if (it.visibility === 'private') continue;
    // BIN-814: subscription subset only — a rentable title must not shield a
    // service from the household dead-weight verdict.
    for (const p of subscriptionProviderIds(it)) active.add(canonicalProviderId(p));
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
  // undefined and [] differ: one is "has not re-shared the flag", the other "nothing new".
  const sameOptionalList = (x: number[] | undefined, y: number[] | undefined): boolean =>
    x === undefined || y === undefined ? x === y : sameList(x, y);
  const sameVotes = (x: HouseholdContributionContent, y: HouseholdContributionContent): boolean => {
    const xv = x.votes ?? {};
    const yv = y.votes ?? {};
    const xk = Object.keys(xv);
    if (xk.length !== Object.keys(yv).length) return false;
    if (xk.length > 0 && x.votesMonth !== y.votesMonth) return false;
    return xk.every(k => yv[Number(k)] === xv[Number(k)]);
  };
  return (
    sameList(a.providerIds, b.providerIds) &&
    sameList(a.activeProviderIds, b.activeProviderIds) &&
    sameNumMap(a.providerCosts, b.providerCosts) &&
    sameCampaigns(a.providerCampaigns, b.providerCampaigns) &&
    sameOptionalList(a.soonProviderIds, b.soonProviderIds) &&
    sameVotes(a, b)
  );
}
