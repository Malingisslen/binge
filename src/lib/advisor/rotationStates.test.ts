import { describe, it, expect } from 'vitest';
import { buildRotationStates } from './rotationStates';

const providers = [
  { providerId: 8, providerName: 'Netflix', shortName: 'Netflix', color: '#e50914', monthlyCost: 119 },
  { providerId: 76, providerName: 'Viaplay', shortName: 'Viaplay', color: '#e0103a', monthlyCost: 449 },
  { providerId: 99, providerName: 'SVT Play', shortName: 'SVT', color: '#1c1c1c', monthlyCost: 0 }, // free
];

describe('buildRotationStates', () => {
  it('drops free (0-cost) providers — nothing to save by rotating', () => {
    const states = buildRotationStates(providers, [], {}, { weeks: 8 });
    expect(states.map(s => s.providerId)).toEqual([8, 76]); // input order, free 99 dropped
  });

  it('sets quietWeeks to the full horizon and nextAiringDate null when nothing is upcoming', () => {
    const states = buildRotationStates([providers[0]], [], {}, { weeks: 8 });
    expect(states[0].quietWeeks).toBe(8);
    expect(states[0].nextAiringDate).toBeNull();
  });

  it('derives quietWeeks from the weekIndex of the earliest upcoming episode', () => {
    const states = buildRotationStates(
      [providers[1]],
      [{ providerId: 76, episodes: [
        { airDate: '2026-08-12', weekIndex: 5 },
        { airDate: '2026-08-26', weekIndex: 7 },
      ] }],
      {},
      { weeks: 8 },
    );
    expect(states[0].quietWeeks).toBe(5);
    expect(states[0].nextAiringDate).toBe('2026-08-12');
  });

  it('picks the earliest air date across multiple shows on the same provider', () => {
    const states = buildRotationStates(
      [providers[0]],
      [
        { providerId: 8, episodes: [{ airDate: '2026-09-01', weekIndex: 6 }] },
        { providerId: 8, episodes: [{ airDate: '2026-07-20', weekIndex: 2 }] },
      ],
      {},
      { weeks: 8 },
    );
    expect(states[0].nextAiringDate).toBe('2026-07-20');
    expect(states[0].quietWeeks).toBe(2);
  });

  it('threads the billing day through from renewalDays, null when unknown', () => {
    const states = buildRotationStates(providers, [], { 8: 15 }, { weeks: 8 });
    expect(states.find(s => s.providerId === 8)!.billingDay).toBe(15);
    expect(states.find(s => s.providerId === 76)!.billingDay).toBeNull();
  });
});
