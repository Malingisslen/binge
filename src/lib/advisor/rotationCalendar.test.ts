import { describe, it, expect } from 'vitest';
import { buildRotationCalendar, type RotationProviderState } from './rotationCalendar';

const TODAY = new Date(2026, 5, 23); // 2026-06-23 (month index 5 = June)

function state(overrides: Partial<RotationProviderState>): RotationProviderState {
  return {
    providerId: 1,
    providerName: 'Provider',
    shortName: 'Prov',
    color: '#000',
    monthlyCost: 100,
    billingDay: null,
    nextAiringDate: null,
    quietWeeks: 6,
    ...overrides,
  };
}

describe('buildRotationCalendar', () => {
  it('excludes providers whose dead-zone is shorter than the threshold', () => {
    const cal = buildRotationCalendar([state({ quietWeeks: 1 })], { today: TODAY });
    expect(cal.entries).toHaveLength(0);
    expect(cal.totalProjectedSavings).toBe(0);
  });

  it('respects a custom deadZoneWeeks threshold', () => {
    const states = [state({ quietWeeks: 4 })];
    expect(buildRotationCalendar(states, { today: TODAY, deadZoneWeeks: 5 }).entries).toHaveLength(0);
    expect(buildRotationCalendar(states, { today: TODAY, deadZoneWeeks: 3 }).entries).toHaveLength(1);
  });

  it('includes a provider exactly at the threshold (quietWeeks === deadZoneWeeks)', () => {
    // boundary: the guard is `quietWeeks < deadZoneWeeks`, so equal must be included.
    const cal = buildRotationCalendar([state({ quietWeeks: 3 })], { today: TODAY }); // default threshold 3
    expect(cal.entries).toHaveLength(1);
  });

  it('cancels before the next billing date and resumes on the air date, prorating savings', () => {
    const cal = buildRotationCalendar(
      [state({ providerId: 76, shortName: 'Viaplay', monthlyCost: 169, billingDay: 15, nextAiringDate: '2026-08-12', quietWeeks: 6 })],
      { today: TODAY },
    );
    const e = cal.entries[0];
    // June 15 already passed → cancel effective at next renewal, July 15.
    expect(e.cancel.date).toBe('2026-07-15');
    expect(e.cancel.kind).toBe('cancel');
    expect(e.resume?.date).toBe('2026-08-12');
    expect(e.resume?.kind).toBe('resume');
    expect(e.daysPaused).toBe(28); // Jul 15 → Aug 12
    expect(e.projectedSavings).toBe(158); // round(169 * 28 / 30)
    expect(cal.totalProjectedSavings).toBe(158);
  });

  it('cancels today when no billing day is known', () => {
    const cal = buildRotationCalendar(
      [state({ billingDay: null, nextAiringDate: null, quietWeeks: 4 })],
      { today: TODAY },
    );
    expect(cal.entries[0].cancel.date).toBe('2026-06-23');
  });

  it('treats a missing air date as an open pause (no resume, zero projected savings)', () => {
    const cal = buildRotationCalendar(
      [state({ monthlyCost: 149, nextAiringDate: null, quietWeeks: 8 })],
      { today: TODAY },
    );
    const e = cal.entries[0];
    expect(e.resume).toBeNull();
    expect(e.daysPaused).toBe(0);
    expect(e.projectedSavings).toBe(0);
  });

  it('treats an air date on/before the cancel date as an open pause (no real gap)', () => {
    const cal = buildRotationCalendar(
      [state({ billingDay: 1, nextAiringDate: '2026-06-25', quietWeeks: 3 })],
      { today: TODAY },
    );
    // billingDay 1 already passed in June → cancel July 1; air date June 25 is before that.
    const e = cal.entries[0];
    expect(e.cancel.date).toBe('2026-07-01');
    expect(e.resume).toBeNull();
    expect(e.projectedSavings).toBe(0);
  });

  it('sorts by projected savings desc, then by cancel date for open pauses', () => {
    const cal = buildRotationCalendar(
      [
        state({ providerId: 337, shortName: 'Disney', billingDay: 1, nextAiringDate: '2026-06-25', quietWeeks: 3 }), // open, cancel Jul 1
        state({ providerId: 384, shortName: 'Max', monthlyCost: 149, billingDay: null, nextAiringDate: null, quietWeeks: 4 }), // open, cancel today
        state({ providerId: 76, shortName: 'Viaplay', monthlyCost: 169, billingDay: 15, nextAiringDate: '2026-08-12', quietWeeks: 6 }), // 158 kr
      ],
      { today: TODAY },
    );
    expect(cal.entries.map((e) => e.shortName)).toEqual(['Viaplay', 'Max', 'Disney']);
    expect(cal.totalProjectedSavings).toBe(158);
  });
});
