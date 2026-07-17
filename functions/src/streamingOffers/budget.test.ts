import { describe, it, expect } from 'vitest';
import { reserveSlot, reserveThrottleSignal, computeNotifyOnceFields, computeClaimReleaseFields } from './budget';

const CAP = 90;

describe('reserveSlot (MOTN quota, BIN-541: cycle is monthly, not daily)', () => {
  it('grants and increments well below the cap', () => {
    expect(reserveSlot(0, CAP)).toEqual({ granted: true, next: 1 });
    expect(reserveSlot(40, CAP)).toEqual({ granted: true, next: 41 });
  });

  it('grants the last slot exactly at cap-1', () => {
    expect(reserveSlot(CAP - 1, CAP)).toEqual({ granted: true, next: CAP });
  });

  it('denies at the cap and spends no slot', () => {
    expect(reserveSlot(CAP, CAP)).toEqual({ granted: false, next: CAP });
  });

  it('denies (and does not decrement) when already over the cap', () => {
    // e.g. confirmed exhaustion burned the bucket to the cap, or two retries straddled a cycle
    expect(reserveSlot(CAP + 5, CAP)).toEqual({ granted: false, next: CAP + 5 });
  });

  it('crash-then-retry within one cycle never exceeds the cap (acceptance scenario)', () => {
    // Run 1 reserves slots 0..49 then crashes; run 2 (retry) resumes from 50.
    let used = 0;
    for (let i = 0; i < 50; i++) used = reserveSlot(used, CAP).next; // run 1: 50 calls
    expect(used).toBe(50);
    let granted = 0;
    for (let i = 0; i < 85; i++) { // run 2 tries a full batch
      const d = reserveSlot(used, CAP);
      if (!d.granted) break;
      used = d.next;
      granted++;
    }
    expect(used).toBe(CAP);        // total reservations capped at 90
    expect(granted).toBe(CAP - 50); // run 2 only got 40 more before the cap
  });
});

describe('reserveThrottleSignal (BIN-541: 429 must be confirmed across 2 runs before burning the month)', () => {
  it('does not confirm exhaustion on a single run\'s 429, and a clean run resets the streak', () => {
    expect(reserveThrottleSignal('rate_limited', 0)).toEqual({ confirmedExhausted: false, nextConsecutive: 1 });
    expect(reserveThrottleSignal('clean', 0)).toEqual({ confirmedExhausted: false, nextConsecutive: 0 });
  });

  it('confirms exhaustion only once a 429 lands on a second run in a row', () => {
    expect(reserveThrottleSignal('rate_limited', 1)).toEqual({ confirmedExhausted: true, nextConsecutive: 2 });
  });

  it('a clean run in between breaks the streak — no confirmation carries over', () => {
    let consecutive = reserveThrottleSignal('rate_limited', 0).nextConsecutive; // run 1: 429
    expect(consecutive).toBe(1);
    consecutive = reserveThrottleSignal('clean', consecutive).nextConsecutive; // run 2: clean
    expect(consecutive).toBe(0);
    const final = reserveThrottleSignal('rate_limited', consecutive); // run 3: 429 again — streak restarts
    expect(final).toEqual({ confirmedExhausted: false, nextConsecutive: 1 });
  });

  it('stays confirmed (idempotent) if 429s keep coming after confirmation', () => {
    expect(reserveThrottleSignal('rate_limited', 2)).toEqual({ confirmedExhausted: true, nextConsecutive: 3 });
  });

  // BIN-541 code review (2026-07-17): a run with no discriminating vendor
  // signal at all (empty batch, or every call denied by our own budget gate
  // before any HTTP call happened) must NOT be treated the same as a clean
  // success — that would erase a legitimate in-progress 2-in-a-row 429 streak
  // for a run that never actually proved the quota was fine.
  it('a no-signal run leaves an in-progress streak untouched — does not falsely clear it', () => {
    const afterFirst429 = reserveThrottleSignal('rate_limited', 0).nextConsecutive; // run 1: 429
    expect(afterFirst429).toBe(1);
    const afterNoSignal = reserveThrottleSignal('no_signal', afterFirst429); // run 2: no vendor call made
    expect(afterNoSignal).toEqual({ confirmedExhausted: false, nextConsecutive: 1 }); // streak preserved, not reset
    const final = reserveThrottleSignal('rate_limited', afterNoSignal.nextConsecutive); // run 3: 429 confirms
    expect(final).toEqual({ confirmedExhausted: true, nextConsecutive: 2 });
  });

  it('a no-signal run at streak 0 stays at 0 (nothing to preserve, nothing to confirm)', () => {
    expect(reserveThrottleSignal('no_signal', 0)).toEqual({ confirmedExhausted: false, nextConsecutive: 0 });
  });
});

// BIN-541 code review (2026-07-17): a prior version of the I/O wrapper this
// feeds (functions/src/util/notifyOnce.ts) skipped extraFields entirely when
// alreadyNotified was true — silently dropping a critical budget-burn write.
// These cases pin the two interactions that bug broke.
describe('computeNotifyOnceFields (BIN-541: budget writes must survive independent of notify outcome)', () => {
  it('marks staleNotified when this call freshly sent', () => {
    expect(computeNotifyOnceFields({ alreadyNotified: false, notifySent: true, extraFields: {} }))
      .toEqual({ staleNotified: true });
  });

  // Test review (2026-07-17): notifyOnce.ts's actual call site always passes
  // notifySent: !alreadyNotified (an OPTIMISTIC pre-call claim, not the real
  // notify() outcome) — {alreadyNotified:false, notifySent:false} can't occur
  // there today. This still validates the function's general contract, but
  // the REAL "notify() turned out to have failed" decision is a separate
  // concern — see computeClaimReleaseFields below, which is what the actual
  // post-notify() outcome feeds.
  it('(general contract) does NOT mark staleNotified when notifySent is false', () => {
    expect(computeNotifyOnceFields({ alreadyNotified: false, notifySent: false, extraFields: {} }))
      .toEqual({});
  });

  it('does NOT mark staleNotified again when already notified earlier this cycle', () => {
    expect(computeNotifyOnceFields({ alreadyNotified: true, notifySent: true, extraFields: {} }))
      .toEqual({});
  });

  it('extraFields (a budget-burn write) always survive, even when already notified', () => {
    const extraFields = { count: 300, consecutive429Runs: 2 };
    expect(computeNotifyOnceFields({ alreadyNotified: true, notifySent: false, extraFields }))
      .toEqual({ count: 300, consecutive429Runs: 2 }); // no staleNotified — already true, not re-marked
  });

  it('extraFields and a fresh staleNotified combine on the confirming call', () => {
    const extraFields = { count: 150, consecutive429Runs: 2 };
    expect(computeNotifyOnceFields({ alreadyNotified: false, notifySent: true, extraFields }))
      .toEqual({ count: 150, consecutive429Runs: 2, staleNotified: true });
  });
});

// Test review (2026-07-17): notifyOnce.ts's optimistic claim-then-release
// redesign added a real decision — what to persist once a CLAIMED notify()
// turns out to have failed — that shipped as an untested inline conditional.
// Extracted to computeClaimReleaseFields specifically so this actual
// post-notify() outcome path (unlike computeNotifyOnceFields's cases above,
// which the real call site only ever calls pre-emptively) is directly tested.
describe('computeClaimReleaseFields (BIN-541: release a claimed notify slot on real failure)', () => {
  it('releases the claim (staleNotified back to false) when notify() did not actually send', () => {
    expect(computeClaimReleaseFields(false)).toEqual({ staleNotified: false });
  });

  it('does nothing when notify() genuinely sent — the claim stands', () => {
    expect(computeClaimReleaseFields(true)).toBeNull();
  });
});
