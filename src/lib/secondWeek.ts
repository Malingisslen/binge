/**
 * BIN-1442 — the client half of "kom tillbaka andra veckan": should this visit be
 * stamped? Mirrors isSecondWeekVisit in functions/src/insights/secondWeek.ts;
 * secondWeek.parity.test.ts runs both against the same cases.
 */
const STOCKHOLM_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' });

function dayNumber(date: Date): number {
  const [y, m, d] = STOCKHOLM_DAY.format(date).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Below this many accounts Insikter says "för få konton" (#22, #6). Mirrors MIN_COHORT on the server. */
export const MIN_COHORT = 5;

export function isSecondWeekVisit(createdAt: Date, visitAt: Date): boolean {
  const days = dayNumber(visitAt) - dayNumber(createdAt);
  return days >= 7 && days <= 13;
}
