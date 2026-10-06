import type { ProviderPauseState } from '@/types';
import { PROVIDER_MAP } from '@/lib/tmdb/providers';

/**
 * BIN-1442 — users/{uid}.pauseReminderNext: the earliest end date among the
 * pauses the user asked to be reminded about, or null. The daily server run finds
 * due users by this one field, so every write of providerPauses writes it too.
 *
 * Must answer exactly what the server's nextPauseReminderAfter(pauses, []) does
 * in functions/src/rotationReminder/pauseReminder.ts — pauseReminder.parity.test.ts.
 */
export function nextPauseReminderDay(pauses: Record<number, ProviderPauseState> | null | undefined): string | null {
  if (!pauses) return null;
  const days = Object.entries(pauses)
    .filter(([id, p]) => PROVIDER_MAP.has(Number(id)) && p?.remind === true
      && typeof p.resumeAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.resumeAt))
    .map(([, p]) => p.resumeAt as string)
    .sort();
  return days[0] ?? null;
}
