// Bindningstid per abonnemang. Ren logik för "är tjänsten bunden just nu",
// slutmånad och pris under bindningen, så rådgivaren, kalendern, paketförslagen och
// kostnadssummorna inte kan vara oense.
//
// Lagrat är bara det användaren själv skrev in ({ months, startedOn, monthlyCost });
// slutmånaden räknas ut vid läsning mot en injicerad `now`. Ett lagrat slutdatum
// skulle sluta stämma så fort längden ändras.
//
// Slutregeln är medvetet försiktig: bunden till och med slutmånaden (startmånad +
// längd). Binge påstår aldrig att man är fri tidigare än man är. Uppsägningstid och
// automatisk förnyelse modelleras inte.
//
// Reglerna i Firestore kan inte kontrollera värdena i kartan, så varje läsare tolkar
// defensivt: en trasig post räknas som "ingen bindning" och kastar aldrig.

import { canonicalProviderId } from '@/lib/tmdb/providers';

export const BINDING_MONTH_OPTIONS = [3, 6, 12, 24] as const;
export type BindingMonths = (typeof BINDING_MONTH_OPTIONS)[number];

export const MAX_BINDINGS = 20;
export const MAX_BINDING_COST_KR = 10_000;

export interface ProviderBinding {
  months: BindingMonths;
  /** 'YYYY-MM' — månaden bindningen började. */
  startedOn: string;
  /** Priset användaren betalar under bindningen, kr/mån. */
  monthlyCost: number;
}

export type ProviderBindings = Record<number, ProviderBinding>;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isValidMonthString(s: unknown): s is string {
  return typeof s === 'string' && MONTH_RE.test(s);
}

/** Tolkar en lagrad post. null för allt som inte är en hel, giltig bindning. */
export function parseBinding(raw: unknown): ProviderBinding | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const months = r.months;
  if (!BINDING_MONTH_OPTIONS.some(m => m === months)) return null;
  if (!isValidMonthString(r.startedOn)) return null;
  const cost = r.monthlyCost;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > MAX_BINDING_COST_KR) return null;
  return { months: months as BindingMonths, startedOn: r.startedOn, monthlyCost: cost };
}

/** Skriv-sidans klampning: null när inmatningen inte är en giltig bindning. */
export function sanitizeBindingInput(input: {
  months: number;
  startedOn: string;
  monthlyCost: number;
}): ProviderBinding | null {
  return parseBinding({ ...input, monthlyCost: Math.round(input.monthlyCost) });
}

/** Läser den lagrade kartan: bara hela, giltiga poster behålls. Kastar aldrig. */
export function readProviderBindings(raw: unknown): ProviderBindings {
  const out: ProviderBindings = {};
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(k);
    if (!Number.isInteger(id) || id <= 0) continue;
    const parsed = parseBinding(v);
    if (parsed) out[canonicalProviderId(id)] = parsed;
  }
  return out;
}

function monthIndex(ym: string): number {
  const m = MONTH_RE.exec(ym)!;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

function monthFromIndex(idx: number): string {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Lokal kalendermånad för `now` som 'YYYY-MM'. */
export function currentMonth(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Sista månaden man är bunden: startmånad + längd. */
export function bindingEndMonth(binding: ProviderBinding): string {
  return monthFromIndex(monthIndex(binding.startedOn) + binding.months);
}

/** Månaden efter slutmånaden — första månaden man kan spara på tjänsten. */
export function monthAfter(ym: string): string {
  return monthFromIndex(monthIndex(ym) + 1);
}

/** Första dagen efter bindningen, 'YYYY-MM-DD' (den 1:a i månaden efter slutmånaden). */
export function bindingFreeFromDate(binding: ProviderBinding): string {
  return `${monthAfter(bindingEndMonth(binding))}-01`;
}

export type BindingState =
  | { kind: 'none' }
  | { kind: 'active'; binding: ProviderBinding; endMonth: string }
  | { kind: 'expired'; binding: ProviderBinding; endMonth: string };

/** Läget för en tjänst vid `now`. Nyckeln kanoniseras, så ett alias-id träffar samma post. */
export function bindingState(
  bindings: Record<number, unknown> | null | undefined,
  providerId: number,
  now: Date,
): BindingState {
  if (!bindings) return { kind: 'none' };
  const binding = parseBinding(bindings[canonicalProviderId(providerId)]);
  if (!binding) return { kind: 'none' };
  // En bindning som ännu inte börjat gäller inte, så förra månadens räkning aldrig
  // prissätts med ett pris som började gälla senare.
  if (currentMonth(now) < binding.startedOn) return { kind: 'none' };
  const endMonth = bindingEndMonth(binding);
  return currentMonth(now) <= endMonth
    ? { kind: 'active', binding, endMonth }
    : { kind: 'expired', binding, endMonth };
}

/** Bindningen om den gäller just nu, annars null. */
export function activeBinding(
  bindings: Record<number, unknown> | null | undefined,
  providerId: number,
  now: Date,
): { binding: ProviderBinding; endMonth: string } | null {
  const s = bindingState(bindings, providerId, now);
  return s.kind === 'active' ? { binding: s.binding, endMonth: s.endMonth } : null;
}

const SV_MONTHS = ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** 'YYYY-MM' som "nov 2027". */
export function formatMonthYear(ym: string): string {
  const m = MONTH_RE.exec(ym);
  if (!m) return ym;
  return `${SV_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * Antal dagar i `[from, to)` som ligger inom bindningen (till och med slutmånaden).
 * Används så att en redan pausad men bunden tjänst inte räknas som sparad för dagar
 * man ändå betalar för.
 */
export function boundDaysBetween(
  binding: ProviderBinding,
  from: Date,
  to: Date,
): number {
  const [y, m] = bindingFreeFromDate(binding).split('-').map(Number);
  const freeFrom = new Date(y, m - 1, 1).getTime();
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  if (end <= start) return 0;
  const boundEnd = Math.min(end, freeFrom);
  if (boundEnd <= start) return 0;
  return Math.round((boundEnd - start) / 86_400_000);
}

/**
 * Sparat belopp för en paus: dagar inom en bindning betalas ändå och räknas aldrig.
 * Delas av rådgivaren (sparat hittills) och av återupptagandet (det bokförda beloppet).
 */
export function pausedSavingsKr(
  monthlyCost: number,
  durationDays: number,
  pausedAt: string,
  bindings: Record<number, unknown> | null | undefined,
  providerId: number,
  now: Date,
): number {
  const state = bindingState(bindings, providerId, now);
  const boundDays = state.kind === 'none'
    ? 0
    : boundDaysBetween(state.binding, new Date(pausedAt + 'T00:00:00'), now);
  return Math.round((monthlyCost * Math.max(0, durationDays - boundDays)) / 30);
}

