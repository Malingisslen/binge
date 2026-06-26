// BIN-181 — rotation-reminder due-detection (pure core of rotationReminderNotify).
//
// The rotation calendar is derived client-side (watchlist × TMDB × costs), so the
// scheduled function can't recompute it. Instead the client persists the confirmed
// schedule inline on users/{uid}.rotationSchedule when the user opts into reminders;
// this helper picks the events that fall due within the reminder window so the
// daily scan can push "Dags att pausa {service}" / "{service} är värt det igen".
//
// Pure (no firebase-admin) — unit-tested under the root Vitest suite. The function
// layer adds the per-event dedup marker (rotationReminderState/{uid}_{pid}_{date}).

export interface RotationScheduleItem {
  providerId: number;
  shortName: string;
  /** ISO yyyy-mm-dd the user plans to cancel. */
  cancelDate: string;
  /** ISO yyyy-mm-dd to resume, or null for an open-ended pause. */
  resumeDate: string | null;
}

export type RotationEventKind = 'cancel' | 'resume';

export interface DueRotationEvent {
  providerId: number;
  shortName: string;
  kind: RotationEventKind;
  date: string;
}

/** ISO yyyy-mm-dd `days` ahead of `todayIso` (UTC date math, no tz drift). */
function isoPlusDays(todayIso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayIso);
  if (!m) return todayIso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Events whose date falls within [today, today + windowDays]. ISO yyyy-mm-dd
 * strings compare lexicographically, so no Date parsing is needed for the bound
 * check. An open-ended pause (resumeDate null) only ever yields its cancel event.
 */
export function dueRotationEvents(
  schedule: readonly RotationScheduleItem[],
  todayIso: string,
  windowDays = 1,
): DueRotationEvent[] {
  const windowEnd = isoPlusDays(todayIso, windowDays);
  const due: DueRotationEvent[] = [];

  for (const item of schedule) {
    if (item.cancelDate >= todayIso && item.cancelDate <= windowEnd) {
      due.push({ providerId: item.providerId, shortName: item.shortName, kind: 'cancel', date: item.cancelDate });
    }
    if (item.resumeDate && item.resumeDate >= todayIso && item.resumeDate <= windowEnd) {
      due.push({ providerId: item.providerId, shortName: item.shortName, kind: 'resume', date: item.resumeDate });
    }
  }
  return due;
}
