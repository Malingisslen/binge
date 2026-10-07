// "Värt det i <månad>": the public month page of package M (BIN-1449). The pure
// parts live here so the level rule, the price wording and the month window are
// tested without TMDB or Firestore. Texts are the ones Malin approved in the
// sketch (2026-10-07).

import { MONTHS_SV } from '@/lib/diary';
import type { PriceChange } from '@/lib/tmdb/providers';

/** The months that get a page. A new month is one more entry here. */
export const VART_DET_MONTHS: readonly string[] = ['2026-11'];

// Hidden until Malin has seen the month after the price agent's run: noindex and
// out of the sitemap, footer and /guider/, like /streamingpriser/. follow keeps the
// links to the calculator. Publishing a month flips this for that month.
export const VART_DET_ROBOTS = { index: false, follow: true } as const;

export interface VartDetMonth {
  id: string;
  year: number;
  name: string;
  /** yyyy-mm-dd, first and last day of the month. */
  firstDay: string;
  lastDay: string;
}

export function parseVartDetMonth(id: string): VartDetMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(id);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    id,
    year,
    name: MONTHS_SV[month - 1],
    firstDay: `${m[1]}-${m[2]}-01`,
    lastDay: `${m[1]}-${m[2]}-${String(days).padStart(2, '0')}`,
  };
}

export function inMonth(isoDate: string | null | undefined, month: VartDetMonth): boolean {
  if (!isoDate) return false;
  const day = isoDate.slice(0, 10);
  return day >= month.firstDay && day <= month.lastDay;
}

export type NewLevel = 'mycket' | 'lite' | 'inget';

export function newLevel(premieres: number): NewLevel {
  if (premieres >= 3) return 'mycket';
  return premieres >= 1 ? 'lite' : 'inget';
}

export const NEW_LEVEL_TEXT: Record<NewLevel, string> = {
  mycket: 'Mycket nytt',
  lite: 'Lite nytt',
  inget: 'Inget nytt',
};

export const LEVEL_RULE_TEXT = 'Mycket nytt betyder minst tre nya säsonger eller filmer från tjänsten under månaden enligt TMDB. '
  + 'Lite nytt betyder en eller två. Binge säger inte vilka tjänster du ska ha, bara vad som kommer och vad det kostar.';

export function introText(month: VartDetMonth, pricesCheckedOn: string | null): string {
  const checked = pricesCheckedOn ? ` Priserna kontrollerades den ${dayText(pricesCheckedOn)}.` : '';
  return `Vad som kommer, vad som blir dyrare och vad som försvinner på svenska streamingtjänster i ${month.name}.${checked}`;
}

/** "3 november" from yyyy-mm-dd. */
export function dayText(isoDate: string): string {
  const [, mm, dd] = isoDate.split('-');
  return `${Number(dd)} ${MONTHS_SV[Number(mm) - 1]}`;
}

/**
 * The price column for a service's cheapest plan: the latest change taking effect
 * in the month ("69 → 89 kr"), else "Oförändrat". A change dated only by month
 * counts for that month. A "noticed" row only says when Binge saw the new price,
 * not when it changed, so it never counts as a change in the month.
 */
export function priceChangeText(
  providerId: number,
  tierId: string | null,
  month: VartDetMonth,
  changes: readonly PriceChange[],
): string {
  const hits = changes
    .filter(c => c.dateKind === 'effective')
    .filter(c => c.providerId === providerId && (c.tierId == null || c.tierId === tierId))
    .filter(c => c.date.length === 7 ? c.date === month.id : inMonth(c.date, month))
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = hits[hits.length - 1];
  return last ? `${last.fromKr} → ${last.toKr} kr` : 'Oförändrat';
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// functions/src/leavingRollup/index.ts WINDOW_DAYS: the rollup looks this many days ahead.
const LEAVING_WINDOW_DAYS = 31;

/**
 * Whether the leaving rollup built on `rollupDay` reaches the end of the month and
 * the month is not over, so its count for the rest of the month is whole.
 */
export function leavingCoversMonth(rollupDay: string | null, month: VartDetMonth): boolean {
  if (!rollupDay) return false;
  return rollupDay <= month.lastDay && addDays(rollupDay, LEAVING_WINDOW_DAYS) >= month.lastDay;
}

/** How many titles leave a service inside the month, from the leaving rollup. */
export function leavingInMonth(entries: readonly { leaving: string }[], month: VartDetMonth): number {
  return entries.filter(e => inMonth(e.leaving, month)).length;
}

export interface Premiere { title: string; date: string; popularity: number }

/** "Exempelserie säsong 2 (12 nov)", then "och 3 till". */
export function premiereText(premieres: readonly Premiere[]): { first: string; more: string | null } | null {
  if (premieres.length === 0) return null;
  const [p] = premieres;
  const [, mm, dd] = p.date.split('-');
  const first = `${p.title} (${Number(dd)} ${MONTHS_SV[Number(mm) - 1].slice(0, 3)})`;
  return { first, more: premieres.length > 1 ? `och ${premieres.length - 1} till` : null };
}

/**
 * The oldest price check among the services shown, so the intro never overstates.
 * A service with no check date means no date can be claimed for all of them.
 */
export function oldestCheck(dates: readonly (string | undefined)[]): string | null {
  if (dates.length === 0 || dates.some(d => !d)) return null;
  return [...(dates as string[])].sort()[0];
}
