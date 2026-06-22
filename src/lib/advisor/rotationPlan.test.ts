import { describe, it, expect } from 'vitest';
import { rotationPlan, type RotationProviderInput } from './rotationPlan';

const p = (over: Partial<RotationProviderInput>): RotationProviderInput => ({
  providerId: 1,
  providerName: 'P',
  shortName: 'P',
  color: '#000',
  monthlyCost: 100,
  backlogCount: 0,
  isFree: false,
  ...over,
});

describe('rotationPlan', () => {
  it('ranks paid providers by backlog-per-krona (value density)', () => {
    const cheap = p({ providerId: 1, monthlyCost: 50, backlogCount: 10 }); // density 0.2
    const dense = p({ providerId: 2, monthlyCost: 100, backlogCount: 40 }); // density 0.4
    const res = rotationPlan([cheap, dense], { horizonMonths: 2 });
    // Densest first.
    expect(res.months[0].provider?.providerId).toBe(2);
    expect(res.months[1].provider?.providerId).toBe(1);
  });

  it('schedules one paid provider per month within the horizon', () => {
    const res = rotationPlan(
      [p({ providerId: 1, backlogCount: 5 }), p({ providerId: 2, backlogCount: 4 }), p({ providerId: 3, backlogCount: 3 })],
      { horizonMonths: 2 },
    );
    expect(res.months).toHaveLength(2);
    expect(res.months.map(m => m.provider?.providerId)).toEqual([1, 2]);
    // The third didn't fit the 2-month horizon.
    expect(res.unscheduled.map(u => u.providerId)).toEqual([3]);
  });

  it('separates free providers as always-available (no rotation needed)', () => {
    const free = p({ providerId: 9, monthlyCost: 0, isFree: true, backlogCount: 7 });
    const paid = p({ providerId: 1, backlogCount: 5 });
    const res = rotationPlan([free, paid], { horizonMonths: 2 });
    expect(res.alwaysFree.map(f => f.providerId)).toEqual([9]);
    // Free is never scheduled into a rotation month.
    expect(res.months.every(m => m.provider?.providerId !== 9)).toBe(true);
    expect(res.months[0].provider?.providerId).toBe(1);
  });

  it('never exceeds the monthly budget — too-expensive providers go unscheduled, not over budget', () => {
    const affordable = p({ providerId: 1, monthlyCost: 99, backlogCount: 5 });
    const tooDear = p({ providerId: 2, monthlyCost: 200, backlogCount: 100 }); // huge backlog but unaffordable
    const res = rotationPlan([affordable, tooDear], { horizonMonths: 3, monthlyBudget: 120 });
    // Pin the scheduled provider's actual cost (not just a ceiling) — catches a
    // corrupted/zeroed cost field that an `every(cost <= budget)` check would miss.
    expect(res.months[0].provider?.providerId).toBe(1);
    expect(res.months[0].cost).toBe(99);
    // The unaffordable one is surfaced as unscheduled, not scheduled over budget.
    expect(res.unscheduled.map(u => u.providerId)).toContain(2);
    expect(res.months.every(m => m.cost <= 120)).toBe(true);
  });

  it('tie-breaks EQUAL value-density by larger backlog first', () => {
    // Genuinely equal density (both 0.10): id 2 = 10/100, id 1 = 14/140. The
    // primary density sort can't separate them, so ONLY the backlog tie-break
    // decides. Smaller-backlog (id 2) listed first → a broken tie-break
    // (return 0 → stable input order) would wrongly pick id 2 for month 0.
    const smaller = p({ providerId: 2, monthlyCost: 100, backlogCount: 10 });
    const larger = p({ providerId: 1, monthlyCost: 140, backlogCount: 14 });
    const res = rotationPlan([smaller, larger], { horizonMonths: 2 });
    expect(res.months[0].provider?.providerId).toBe(1);
    expect(res.months[1].provider?.providerId).toBe(2);
  });

  it('floors the horizon at 1 month (horizonMonths: 0)', () => {
    const res = rotationPlan([p({ providerId: 1, backlogCount: 5 })], { horizonMonths: 0 });
    expect(res.months).toHaveLength(1);
  });

  it('emits gap months when fewer candidates than horizon', () => {
    const res = rotationPlan([p({ providerId: 1, backlogCount: 5 })], { horizonMonths: 3 });
    expect(res.months).toHaveLength(3);
    expect(res.months[0].provider?.providerId).toBe(1);
    expect(res.months[1].provider).toBeNull();
    expect(res.months[2].provider).toBeNull();
    expect(res.months[1].cost).toBe(0);
  });

  it('excludes paid providers with zero backlog', () => {
    const empty = p({ providerId: 1, backlogCount: 0 });
    const withBacklog = p({ providerId: 2, backlogCount: 3 });
    const res = rotationPlan([empty, withBacklog], { horizonMonths: 2 });
    expect(res.months[0].provider?.providerId).toBe(2);
    expect(res.months[1].provider).toBeNull();
  });

  it('totals reflect only scheduled months', () => {
    const res = rotationPlan(
      [p({ providerId: 1, monthlyCost: 100, backlogCount: 10 }), p({ providerId: 2, monthlyCost: 150, backlogCount: 8 })],
      { horizonMonths: 4 },
    );
    expect(res.totalCost).toBe(250);
    expect(res.totalBacklogCleared).toBe(18);
  });

  it('returns the full documented shape', () => {
    const res = rotationPlan([p({ providerId: 1, backlogCount: 5 })], { horizonMonths: 1 });
    expect(res).toEqual({
      months: [{ monthOffset: 0, provider: expect.objectContaining({ providerId: 1 }), cost: 100, backlogCleared: 5 }],
      totalCost: 100,
      totalBacklogCleared: 5,
      alwaysFree: [],
      unscheduled: [],
    });
  });

  it('defaults to a 4-month horizon', () => {
    const res = rotationPlan([p({ providerId: 1, backlogCount: 5 })]);
    expect(res.months).toHaveLength(4);
  });
});
