'use client';

import DuotoneFilters from '@/components/ui/DuotoneFilters';

// BIN-1033 — the prelude every `AppShell` branch opens with, in one place.
//
// `AppShell` has four branches that each take over or render the shell (deletion limbo,
// the reconsent gate, the guest landing, the normal app). All four opened with the same
// two nodes, and BIN-909 added the fourth copy. #2 Accessibility's condition 13 on that
// ticket required the new branch to keep the block; four copies is one way to satisfy it
// and one copy is a better one.
//
// SCOPE IS THE PAIR, NOT THE SHELL. `<main id="main">` is deliberately NOT in here: two
// branches render it themselves and two get it from the component they hand off to
// (`DeletionLimbo`, `ReconsentGate`), with different classes each time. Hoisting it would
// turn a mechanical extraction into a children-plumbing change (#26's condition 1, #2's
// condition 4).
//
// No wrapping element: the pair is returned in a fragment so no landmark or extra node
// appears between the skip link and its target (#2's condition 3). The skip link stays the
// first focusable node in every branch, which is the only property that makes it a skip
// link (#2's condition 1).
export function ShellChrome() {
  return (
    <>
      <DuotoneFilters />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-pop"
      >
        Hoppa till innehåll
      </a>
    </>
  );
}
