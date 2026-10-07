// Package M — the monthly bill, "Din streaming i september": what each paid
// service cost last month per episode or film the user checked off in Binge.
// Pure; the hook feeds it the library, the checked-off episodes and the pauses.
//
// Differs from serviceValue.ts (films only, current month, kr/h): the bill covers
// a CLOSED month and counts episodes too, because "449 kr för ett avsnitt" is the
// sentence the card exists to say.
//
// An episode counts toward the month it was checked off in, not the month it was
// watched: checking off a whole old season stamps every episode with the same
// moment. The card's fine print says "det du bockat av" for exactly that reason.

import { attributeProvider } from '@/lib/advisor/serviceValue';
import { subscriptionProviderIds } from '@/lib/watchlist/subscriptionProviders';
import { canonicalProviderId } from '@/lib/tmdb/providers';
import { seenDate } from '@/lib/seenDate';
import { MONTHS_SV } from '@/lib/diary';
import { formatKr } from '@/lib/formatKr';
import type { WatchlistItem } from '@/types';


export interface BillMonth {
  startMs: number;
  endMs: number; // exclusive
  /** Lower-case Swedish month name, e.g. 'september'. */
  name: string;
  /** First and last calendar day as yyyy-mm-dd, for comparing with pause dates. */
  firstDay: string;
  lastDay: string;
}

/** The calendar month before the one `now` falls in, in local time. */
export function previousMonth(now: Date): BillMonth {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 0);
  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    name: MONTHS_SV[start.getMonth()],
    firstDay: isoDay(start),
    lastDay: isoDay(last),
  };
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface CheckedOffEpisode { tmdbId: number; watchedAt: Date }

/** A pause as stored: an active one has no resumedAt. Dates are yyyy-mm-dd. */
export interface BillPause { providerId: number; pausedAt: string; resumedAt: string | null }

export interface BillLine {
  providerId: number;
  /** What the month cost: 0 when the service was paused the whole month. */
  costKr: number;
  pausedWholeMonth: boolean;
  episodes: number;
  films: number;
  /** costKr divided by episodes + films, rounded; null when nothing was checked off. */
  krPerItem: number | null;
}

export interface MonthlyBill {
  month: BillMonth;
  lines: BillLine[];
  totalKr: number;
  episodes: number;
  films: number;
  krPerItem: number | null;
}

// A service is free for the month only when one pause covers every day of it. A
// pause that starts or ends inside the month still leaves that month's charge,
// since the services bill a month at a time.
function pausedWholeMonth(providerId: number, pauses: readonly BillPause[], month: BillMonth): boolean {
  return pauses.some(p =>
    canonicalProviderId(p.providerId) === providerId
    && p.pausedAt <= month.firstDay
    && (p.resumedAt == null || p.resumedAt > month.lastDay));
}

/**
 * The bill for `month`, or null when there is nothing honest to show: no paid
 * service, or nothing checked off at all that month (then every service would read
 * as unused only because the user did not log).
 */
export function buildMonthlyBill(params: {
  items: readonly WatchlistItem[];
  episodes: readonly CheckedOffEpisode[];
  ownedProviderIds: readonly number[];
  costFor: (providerId: number) => number;
  pauses: readonly BillPause[];
  month: BillMonth;
}): MonthlyBill | null {
  const { items, episodes, ownedProviderIds, costFor, pauses, month } = params;
  const owned = [...ownedProviderIds];
  const inMonth = (d: Date) => d.getTime() >= month.startMs && d.getTime() < month.endMs;

  const lines = new Map<number, BillLine>();
  for (const raw of owned) {
    const id = canonicalProviderId(raw);
    if (lines.has(id)) continue;
    const paused = pausedWholeMonth(id, pauses, month);
    lines.set(id, { providerId: id, costKr: paused ? 0 : costFor(id), pausedWholeMonth: paused, episodes: 0, films: 0, krPerItem: null });
  }

  // A title on several of the user's services is credited among those that were paid
  // for that month, so neither a paused nor a free service takes the episodes from
  // the one on the bill.
  const creditable = [...lines.values()].filter(l => l.costKr > 0).map(l => l.providerId);

  let checkedOff = 0;
  for (const item of items) {
    if (item.mediaType !== 'movie') continue;
    const date = seenDate(item);
    if (!date || !inMonth(date)) continue;
    checkedOff += 1;
    const id = attributeProvider(subscriptionProviderIds(item), creditable);
    const line = id == null ? undefined : lines.get(id);
    if (line) line.films += 1;
  }

  // Episodes only ever belong to a show, so key the lookup on TV rows alone; a film
  // sharing the tmdbId must not claim them (the diary's BIN-560 fix).
  const showById = new Map(items.filter(i => i.mediaType === 'tv').map(i => [i.tmdbId, i]));
  for (const ep of episodes) {
    if (!inMonth(ep.watchedAt)) continue;
    const show = showById.get(ep.tmdbId);
    if (!show) continue;
    checkedOff += 1;
    const id = attributeProvider(subscriptionProviderIds(show), creditable);
    const line = id == null ? undefined : lines.get(id);
    if (line) line.episodes += 1;
  }

  const paid = [...lines.values()].filter(l => l.costKr > 0 || l.pausedWholeMonth);
  if (checkedOff === 0 || !paid.some(l => l.costKr > 0)) return null;

  for (const line of paid) {
    const count = line.episodes + line.films;
    line.krPerItem = count > 0 && line.costKr > 0 ? Math.round(line.costKr / count) : null;
  }

  // Dearest service first, paused ones last. Sorted by price rather than by kr per
  // item, so the card states what each line cost without ranking the services as
  // worst value (#24's condition, BIN-1449).
  paid.sort((a, b) => Number(a.pausedWholeMonth) - Number(b.pausedWholeMonth) || b.costKr - a.costKr || a.providerId - b.providerId);

  const totalKr = paid.reduce((sum, l) => sum + l.costKr, 0);
  const episodesTotal = paid.reduce((sum, l) => sum + l.episodes, 0);
  const filmsTotal = paid.reduce((sum, l) => sum + l.films, 0);
  const counted = episodesTotal + filmsTotal;
  return {
    month,
    lines: paid,
    totalKr,
    episodes: episodesTotal,
    films: filmsTotal,
    krPerItem: counted > 0 ? Math.round(totalKr / counted) : null,
  };
}

// The card's wording, kept beside the numbers it describes so the texts Malin
// approved (BIN-1449 sketch, 2026-10-07) are tested in one place.

function countText(episodes: number, films: number): string {
  const ep = `${episodes} avsnitt`;
  const fi = `${films} ${films === 1 ? 'film' : 'filmer'}`;
  if (episodes > 0 && films > 0) return `${ep} och ${fi}`;
  return episodes > 0 ? ep : fi;
}

function unitText(episodes: number, films: number): string {
  if (episodes > 0 && films > 0) return 'avsnitt eller film';
  return episodes > 0 ? 'avsnitt' : 'film';
}

/** The small line under a service on the card. */
export function billLineText(line: BillLine, monthName: string): string {
  if (line.pausedWholeMonth) return `Pausad hela ${monthName}`;
  const count = line.episodes + line.films;
  if (count === 0 || line.krPerItem == null) return `Inget sett i ${monthName}`;
  if (count === 1) {
    return line.episodes === 1
      ? `1 avsnitt · ${line.krPerItem} kr för ett avsnitt`
      : `1 film · ${line.krPerItem} kr för en film`;
  }
  return `${countText(line.episodes, line.films)} · ${line.krPerItem} kr per ${unitText(line.episodes, line.films)}`;
}

/** The two halves of the line under the total. */
export function billTotalText(bill: MonthlyBill): { count: string; perItem: string | null } {
  return {
    count: countText(bill.episodes, bill.films),
    perItem: bill.krPerItem == null ? null : `${bill.krPerItem} kr per ${unitText(bill.episodes, bill.films)}`,
  };
}

/**
 * A service's row on the shared image: its price per thing checked off. A paused
 * service is left off, and nothing names what was watched (BIN-1449 sketch, part 2).
 */
export function billShareRowText(line: BillLine): string | null {
  if (line.pausedWholeMonth) return null;
  const count = line.episodes + line.films;
  if (count === 0 || line.krPerItem == null) return 'Inget sett';
  if (count === 1) return line.episodes === 1 ? `${line.krPerItem} kr för ett avsnitt` : `${line.krPerItem} kr för en film`;
  return `${line.krPerItem} kr per ${unitText(line.episodes, line.films)}`;
}

/** The line that goes with the image in the phone's share sheet. */
export function billShareText(bill: MonthlyBill): string {
  return `Min streaming i ${bill.month.name}: ${formatKr(bill.totalKr)} kr. Räkna på din egen på binge.nu`;
}
