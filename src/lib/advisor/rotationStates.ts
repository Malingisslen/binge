// BIN-181 — assemble per-provider rotation state from live advisor data.
//
// The pure `buildRotationCalendar` (rotationCalendar.ts) takes a
// RotationProviderState[]; this helper derives that array from the advisor's
// provider list + the upcoming-episodes view + the user's billing days, so the
// hook layer stays glue. Kept pure (no React) for unit testing.
//
// Per provider: quietWeeks = how many empty weeks precede its next followed
// episode (weekIndex of the earliest upcoming episode), or the full horizon when
// nothing is upcoming; nextAiringDate = that earliest episode's air date (null =
// open-ended pause). Only PAID services are emitted — a free service has no
// savings to rotate for.

import type { RotationProviderState } from './rotationCalendar';

export interface RotationProviderLite {
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  monthlyCost: number | null;
}

export interface RotationUpcomingLite {
  providerId: number;
  episodes: { airDate: string; weekIndex: number }[];
}

export function buildRotationStates(
  providers: readonly RotationProviderLite[],
  upcomingShows: readonly RotationUpcomingLite[],
  renewalDays: Record<number, number>,
  opts: { weeks: number },
): RotationProviderState[] {
  // Earliest upcoming followed episode per provider.
  const earliestByProvider = new Map<number, { date: string; weekIndex: number }>();
  for (const s of upcomingShows) {
    for (const e of s.episodes) {
      const cur = earliestByProvider.get(s.providerId);
      if (!cur || e.airDate < cur.date) {
        earliestByProvider.set(s.providerId, { date: e.airDate, weekIndex: e.weekIndex });
      }
    }
  }

  const states: RotationProviderState[] = [];
  for (const p of providers) {
    const cost = p.monthlyCost ?? 0;
    if (cost <= 0) continue; // free services can't be rotated for savings
    const earliest = earliestByProvider.get(p.providerId);
    const quietWeeks = earliest ? Math.max(0, earliest.weekIndex) : opts.weeks;
    states.push({
      providerId: p.providerId,
      providerName: p.providerName,
      shortName: p.shortName,
      color: p.color,
      monthlyCost: cost,
      billingDay: renewalDays[p.providerId] ?? null,
      nextAiringDate: earliest ? earliest.date : null,
      quietWeeks,
    });
  }
  return states;
}
