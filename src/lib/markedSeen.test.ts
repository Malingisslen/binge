// BIN-1008 — the guard BIN-689 left as prose.
//
// The decisive case is the ONE input where the two rules disagree: a title marked 'sedd'
// whose `watchedAt` is null. `seenDate` says "no countable date"; this rule says "yes,
// counted". Every other input gives the same answer either way, so this pair is the whole
// test — a suite that only exercised ordinary rows would stay green under the exact
// "finish the migration" edit this file exists to stop.

import { describe, it, expect } from 'vitest';
import { markedSeen } from './markedSeen';
import { seenDate } from './seenDate';
import type { WatchStatus } from '@/types/domain';

const row = (status: WatchStatus, watchedAt: Date | null) => ({ status, watchedAt });

const SEDD_NO_DATE = row('sedd', null);
const SEDD_WITH_DATE = row('sedd', new Date('2026-01-02'));
const DROPPED_WITH_DATE = row('avbruten', new Date('2026-01-02'));
const WILL_SEE = row('vill_se', null);

describe('markedSeen', () => {
  it('counts a sedd title whose watchedAt is null', () => {
    // The mutation this suite exists to kill: swapping the body to `seenDate(i) != null`
    // drops this row, and both "Sedd" tiles quietly under-report.
    expect(markedSeen([SEDD_NO_DATE])).toEqual([SEDD_NO_DATE]);
  });

  it('does NOT count a dropped title that still carries an old date', () => {
    // `watchedAt` is not cleared when a title leaves 'sedd' (BIN-593), so this row is
    // ordinary real data, not a contrived one. It kills a mutant the case above cannot:
    // one that WIDENS the rule to `status === 'sedd' || watchedAt != null` rather than
    // replacing it.
    expect(markedSeen([DROPPED_WITH_DATE])).toEqual([]);
  });

  it('keeps the sedd rows and drops the rest, in order', () => {
    expect(markedSeen([WILL_SEE, SEDD_NO_DATE, DROPPED_WITH_DATE, SEDD_WITH_DATE]))
      .toEqual([SEDD_NO_DATE, SEDD_WITH_DATE]);
  });

  it('and the two rules genuinely disagree on that row — which is why there are two', () => {
    // Pins the premise of the whole split rather than trusting the header comment. If
    // this ever passes with both rules agreeing, one of them has been changed and the
    // separation has stopped meaning anything.
    expect(markedSeen([SEDD_NO_DATE])).toHaveLength(1);
    expect(seenDate(SEDD_NO_DATE)).toBeNull();
  });
});
