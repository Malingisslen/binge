/**
 * BIN-1449 — who gets the monthly bill card on the 1st. Pure (no firebase-admin),
 * tested under the root vitest suite, and checked against the client's
 * `buildMonthlyBill` by `src/lib/advisor/monthlyBillNotify.parity.test.ts`: a card
 * goes out exactly when the bill in Rådgivaren has something to show.
 */

import { PROVIDER_PAID, canonicalPaidId } from '../shared/providerPaid';

const MONTHS_SV = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

export interface NotifyMonth {
  /** yyyy-mm, used in the card id. */
  id: string;
  name: string;
  firstDay: string;
  lastDay: string;
  /** Stockholm midnight at the month's start, and at the next month's start (exclusive). */
  startMs: number;
  endMs: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The UTC instant of Stockholm midnight on a calendar day (handles CET/CEST). */
export function stockholmMidnightMs(year: number, month1: number, day: number): number {
  const guess = Date.UTC(year, month1 - 1, day);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Stockholm', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value);
  const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return guess - (localAsUtc - guess);
}

/** The calendar month before the one `now` falls in, in Stockholm time. */
export function previousStockholmMonth(now: Date): NotifyMonth {
  const [y, m] = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(now).split('-').map(Number);
  const year = m === 1 ? y - 1 : y;
  const month1 = m === 1 ? 12 : m - 1;
  const days = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  return {
    id: `${year}-${pad(month1)}`,
    name: MONTHS_SV[month1 - 1],
    firstDay: `${year}-${pad(month1)}-01`,
    lastDay: `${year}-${pad(month1)}-${pad(days)}`,
    startMs: stockholmMidnightMs(year, month1, 1),
    endMs: stockholmMidnightMs(y, m, 1),
  };
}

export interface BillUser {
  myProviders?: unknown;
  providerTiers?: Record<string, string>;
  providerCosts?: Record<string, number>;
  providerPauses?: Record<string, { pausedAt?: unknown }>;
  providerCampaigns?: Record<string, { monthlyCost?: unknown; endDate?: unknown }>;
  notificationSettings?: unknown;
}

/**
 * The user turned the card off in Inställningar, Notiser. Only an explicit false
 * counts: the setting is on by default, and an account created before it existed,
 * or one holding a malformed value, keeps getting the card it was promised.
 */
export function monthlyBillOptedOut(user: BillUser): boolean {
  const settings = user.notificationSettings;
  return !!settings && typeof settings === 'object' && (settings as { monthlyBill?: unknown }).monthlyBill === false;
}

export interface BillPause { providerId: number; pausedAt: string; resumedAt: string | null }

/** A yyyy-mm-dd that names a real day, as the client's parseLocalEndDate accepts. */
function isRealDay(day: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/**
 * Whether the service costs money, resolved like the client's
 * resolveEffectiveMonthlyCost priced on the month's last day: a chosen tier that
 * exists, else the user's own price, else the catalog default. When one of those
 * exists, a campaign above zero still running on that day replaces it.
 */
function costsMoney(id: number, user: BillUser, month: NotifyMonth): boolean {
  const entry = PROVIDER_PAID[id];
  if (!entry) return false;
  const tier = user.providerTiers?.[String(id)];
  const custom = user.providerCosts?.[String(id)];
  let ordinaryPaid: boolean | null;
  // Same order as the client's resolveProviderMonthlyCost: a free service is free first.
  if (entry.free) ordinaryPaid = false;
  else if (tier && Object.prototype.hasOwnProperty.call(entry.tiers, tier)) ordinaryPaid = entry.tiers[tier];
  else if (typeof custom === 'number') ordinaryPaid = custom > 0;
  else ordinaryPaid = entry.hasDefault ? entry.defaultPaid : null;
  if (ordinaryPaid == null) return false;
  const campaign = user.providerCampaigns?.[String(id)];
  const campaignRuns = !!campaign && typeof campaign.monthlyCost === 'number' && Number.isFinite(campaign.monthlyCost)
    && campaign.monthlyCost > 0 && typeof campaign.endDate === 'string' && isRealDay(campaign.endDate)
    && campaign.endDate >= month.lastDay;
  return campaignRuns || ordinaryPaid;
}

function pausedWholeMonth(id: number, pauses: readonly BillPause[], month: NotifyMonth): boolean {
  return pauses.some(p =>
    canonicalPaidId(p.providerId) === id
    && p.pausedAt <= month.firstDay
    && (p.resumedAt == null || p.resumedAt > month.lastDay));
}

/** The active pauses on the user document, in the same shape as the history. */
export function activePauses(user: BillUser): BillPause[] {
  return Object.entries(user.providerPauses ?? {}).flatMap(([id, p]) =>
    typeof p?.pausedAt === 'string' ? [{ providerId: Number(id), pausedAt: p.pausedAt, resumedAt: null }] : []);
}

/** At least one of the user's services cost money for the month. */
export function hasPaidService(user: BillUser, pauses: readonly BillPause[], month: NotifyMonth): boolean {
  const owned = Array.isArray(user.myProviders) ? user.myProviders.filter((x): x is number => typeof x === 'number') : [];
  const ids = new Set(owned.map(canonicalPaidId).filter((x): x is number => x != null));
  return [...ids].some(id => costsMoney(id, user, month) && !pausedWholeMonth(id, pauses, month));
}

type Stamp = { toMillis(): number } | Date | null | undefined;

function stampMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (v && typeof (v as { toMillis?: unknown }).toMillis === 'function') return (v as { toMillis(): number }).toMillis();
  return null;
}

function inMonth(v: unknown, month: NotifyMonth): boolean {
  const ms = stampMs(v);
  return ms != null && ms >= month.startMs && ms < month.endMs;
}

// The stored film statuses the client's migrateStatus reads as 'sedd'; older rows
// still carry the English and pre-rename names.
const SEEN_FILM_STATUSES = new Set(['sedd', 'watched', 'watching', 'följer', 'mina']);

/** A film row the client counts: seen and not dropped, with its seen date inside the month. */
export function filmCheckedOff(doc: { mediaType?: unknown; status?: unknown; dropped?: unknown; watchedAt?: Stamp }, month: NotifyMonth): boolean {
  return doc.mediaType === 'movie' && !doc.dropped && typeof doc.status === 'string'
    && SEEN_FILM_STATUSES.has(doc.status) && inMonth(doc.watchedAt, month);
}

/**
 * The watchlist doc ids an episodeProgress doc's show can live under: the
 * namespaced `tv_N`, then a legacy bare `N`. The client matches on tmdbId, so
 * either counts.
 */
export function showDocIds(progressDocId: string): string[] {
  const m = /^(?:tv_)?([1-9][0-9]*)$/.exec(progressDocId);
  return m ? [`tv_${m[1]}`, m[1]] : [];
}

/** An episodeProgress document with an episode checked off inside the month. */
export function episodeCheckedOff(doc: { seasons?: unknown }, month: NotifyMonth): boolean {
  const seasons = doc.seasons;
  if (!seasons || typeof seasons !== 'object') return false;
  return Object.values(seasons as Record<string, unknown>).some(eps =>
    !!eps && typeof eps === 'object'
    && Object.values(eps as Record<string, unknown>).some(ep => {
      const e = ep as { watched?: unknown; watchedAt?: unknown } | null;
      return e?.watched === true && inMonth(e.watchedAt, month);
    }));
}

export const MONTHLY_BILL_BODY_TAIL = 'Se vad varje tjänst kostade per avsnitt.';

/** The bell card, under an id that makes a second write for the month a no-op. */
export function monthlyBillCard(month: NotifyMonth): { id: string; title: string; body: string } {
  return {
    id: `monthly-bill-${month.id}`,
    title: `Din streaming i ${month.name}`,
    body: `Du har streamat klart i ${month.name}. ${MONTHLY_BILL_BODY_TAIL}`,
  };
}
