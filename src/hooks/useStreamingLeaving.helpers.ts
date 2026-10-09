import type { LeavingEntry } from '@/hooks/useStreamingLeaving';

/** Titlar vars sista dag är idag eller senare. `today` och `leaving` är båda yyyy-mm-dd. */
export function dropPassed(entries: LeavingEntry[], today: string): LeavingEntry[] {
  return entries.filter(e => e.leaving >= today);
}
