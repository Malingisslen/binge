// BIN-1442 — "Påminn mig" after Pausa: the pure core of the pause-reminder pass in
// rotationReminderNotify. Pure (no firebase-admin), unit-tested under the root suite.
//
// The reminder lives on the user's own pause: providerPauses[id] = { pausedAt,
// resumeAt, remind: true }, plus users/{uid}.pauseReminderNext, the earliest
// resumeAt among reminded pauses, so the daily run can find due users with one
// single-field range query (`<= today`; a missed run is caught up the next day).
// The client computes pauseReminderNext with nextPauseReminderDay in
// src/lib/pauseReminder.ts; pauseReminder.parity.test.ts keeps the two equal.
//
// Every field here is client-writable, so nothing in it is trusted: dates must be
// yyyy-mm-dd, the service must be one PROVIDER_NAMES knows, and the name printed
// comes from that list, never from the document.

import { PROVIDER_NAMES } from '../shared/providerNames';

/** More pauses than there are services is a crafted document; read no further. */
export const MAX_PAUSES_READ = 30;
/** "Släpper avsnitt" means a next episode within this many days. */
export const AIRING_WINDOW_DAYS = 14;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface PauseReminder {
  providerId: number;
  providerName: string;
  resumeAt: string;
}

function remindedPauses(providerPauses: unknown): PauseReminder[] {
  if (!providerPauses || typeof providerPauses !== 'object') return [];
  const out: PauseReminder[] = [];
  for (const [key, raw] of Object.entries(providerPauses as Record<string, unknown>).slice(0, MAX_PAUSES_READ)) {
    const providerId = Number(key);
    const providerName = PROVIDER_NAMES[providerId];
    if (!providerName || !raw || typeof raw !== 'object') continue;
    const p = raw as { remind?: unknown; resumeAt?: unknown };
    if (p.remind !== true || typeof p.resumeAt !== 'string' || !DAY.test(p.resumeAt)) continue;
    out.push({ providerId, providerName, resumeAt: p.resumeAt });
  }
  return out;
}

/** Reminders whose pause ends today or ended on a day the run missed. */
export function duePauseReminders(providerPauses: unknown, todayIso: string): PauseReminder[] {
  return remindedPauses(providerPauses).filter(r => r.resumeAt <= todayIso);
}

/** The earliest reminder left once `done` are cleared, or null for none. */
export function nextPauseReminderAfter(providerPauses: unknown, done: readonly number[]): string | null {
  const days = remindedPauses(providerPauses)
    .filter(r => !done.includes(r.providerId))
    .map(r => r.resumeAt)
    .sort();
  return days[0] ?? null;
}

function isoPlusDays(todayIso: string, days: number): string {
  const [y, m, d] = todayIso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export interface FollowedSeries {
  subscriptionProviders?: unknown;
  nextAirDate?: unknown;
}

/** Followed series on that service with a next episode inside the window. */
export function countFollowedAiring(series: readonly FollowedSeries[], providerId: number, todayIso: string): number {
  const end = isoPlusDays(todayIso, AIRING_WINDOW_DAYS);
  return series.filter(s =>
    Array.isArray(s.subscriptionProviders) && s.subscriptionProviders.includes(providerId)
    && typeof s.nextAirDate === 'string' && s.nextAirDate >= todayIso && s.nextAirDate <= end,
  ).length;
}

/** The approved wording (Malin, 2026-10-06), with a plain line when nothing airs. */
export function pauseReminderBody(providerName: string, airingCount: number): string {
  if (airingCount <= 0) return `${providerName}: din paus tar slut i dag. Dags att starta om?`;
  const serier = airingCount === 1 ? 'serie' : 'serier';
  return `${providerName} har nytt igen: ${airingCount} ${serier} du följer släpper avsnitt. Dags att starta om?`;
}
