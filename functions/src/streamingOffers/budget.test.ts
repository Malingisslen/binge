import { describe, it, expect } from 'vitest';
import { reserveSlot } from './budget';

const CAP = 90;

describe('reserveSlot (MOTN daily quota)', () => {
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
    // e.g. a 429 burned the bucket to the cap, or two retries straddled a day
    expect(reserveSlot(CAP + 5, CAP)).toEqual({ granted: false, next: CAP + 5 });
  });

  it('crash-then-retry within one day never exceeds the cap (acceptance scenario)', () => {
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
