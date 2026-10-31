'use client';

import { formatKr } from '@/lib/formatKr';
import type { ActivePause } from '@/types';
import { Eyebrow } from '@/components/ui/Eyebrow';

// Finished pauses (the ledger) plus what the running pauses have saved so far.
// The history is read once by the page and shared with the sidebar, so this takes
// it as props instead of opening a second Firestore listener.
export default function SavedSoFar({ activePauses, historySaved, isLoading }: {
  activePauses: ActivePause[];
  historySaved: number;
  isLoading: boolean;
}) {
  const saved = historySaved + activePauses.reduce((sum, p) => sum + p.savingsSoFar, 0);

  return (
    <div className="flex items-baseline gap-2.5 mb-3.5 min-h-8">
      <Eyebrow as="h2" size="xs">Sparat hittills</Eyebrow>
      {isLoading ? (
        // Holds the figure's height so the answer below does not jump when it lands.
        <span role="status" aria-busy="true" className="animate-pulse self-center">
          <span className="sr-only">Hämtar sparat belopp</span>
          <span data-skeleton aria-hidden className="block h-6 w-24 bg-rule-2 rounded-sm" />
        </span>
      ) : saved > 0 ? (
        <span className="text-2xl font-bold text-season-done tabular-nums">{formatKr(saved)} kr</span>
      ) : (
        <span className="text-xs text-ink-3">Inget än. Din första paus räknas här.</span>
      )}
    </div>
  );
}
