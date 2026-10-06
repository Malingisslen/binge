/**
 * BIN-1442 — "kom tillbaka andra veckan". An account counts as having come back
 * when it opened Binge on Stockholm day 7..13 after the day it was created. The
 * client stamps users/{uid}.secondWeekVisitAt once in that window; the rollup
 * counts cohorts whose window has fully closed.
 *
 * Hand-mirrored in src/lib/secondWeek.ts (the client cannot import functions/);
 * src/lib/secondWeek.parity.test.ts runs both against the same cases.
 */
import { stockholmDayId } from '../util/dayId';

export const SECOND_WEEK_FIRST_DAY = 7;
export const SECOND_WEEK_LAST_DAY = 13;
/** Cohorts reported: accounts whose second week ended within the last 30 days. */
export const COHORT_SPAN_DAYS = 30;
/** Below this many accounts the figure says "för få konton" instead (#22, #6). */
export const MIN_COHORT = 5;

function dayNumber(date: Date): number {
  const [y, m, d] = stockholmDayId(date).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Whole Stockholm days from `from`'s day to `to`'s day. */
export function stockholmDaysBetween(from: Date, to: Date): number {
  return dayNumber(to) - dayNumber(from);
}

export function isSecondWeekVisit(createdAt: Date, visitAt: Date): boolean {
  const days = stockholmDaysBetween(createdAt, visitAt);
  return days >= SECOND_WEEK_FIRST_DAY && days <= SECOND_WEEK_LAST_DAY;
}

/**
 * The createdAt range [start, end) of the reported cohorts: accounts at least
 * 14 Stockholm days old (their window has closed), at most 14 + 30. Returned as
 * instants for a single range query; the per-document check still decides.
 */
export function cohortCreatedRange(now: Date): { start: Date; end: Date } {
  const closedAfter = SECOND_WEEK_LAST_DAY + 1;
  const end = new Date(now.getTime() - (closedAfter - 1) * 86_400_000);
  const start = new Date(end.getTime() - (COHORT_SPAN_DAYS + 1) * 86_400_000);
  return { start, end };
}

export interface CohortRow {
  createdAt?: unknown;
  secondWeekVisitAt?: unknown;
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (v && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  return null;
}

/**
 * X of Y. Y: accounts whose second week has closed and is at most
 * COHORT_SPAN_DAYS old; a missing or malformed createdAt is excluded, never
 * counted as a zero. X: those with a secondWeekVisitAt that really falls in the
 * window (the field is owner-writable, so a forged one outside it is ignored).
 */
export function secondWeekReturn(rows: readonly CohortRow[], now: Date): { returned: number; cohort: number } {
  let returned = 0;
  let cohort = 0;
  for (const row of rows) {
    const createdAt = asDate(row.createdAt);
    if (!createdAt) continue;
    const age = stockholmDaysBetween(createdAt, now);
    if (age <= SECOND_WEEK_LAST_DAY || age > SECOND_WEEK_LAST_DAY + COHORT_SPAN_DAYS) continue;
    cohort += 1;
    const visit = asDate(row.secondWeekVisitAt);
    if (visit && isSecondWeekVisit(createdAt, visit)) returned += 1;
  }
  return { returned, cohort };
}
