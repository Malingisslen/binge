import { describe, it, expect } from 'vitest';
import {
  countFollowedAiring,
  duePauseReminders,
  MAX_PAUSES_READ,
  nextPauseReminderAfter,
  pauseReminderBody,
} from './pauseReminder';

const pause = (resumeAt: unknown, remind: unknown = true) => ({ pausedAt: '2026-10-01', resumeAt, remind });

describe('duePauseReminders (BIN-1442)', () => {
  it('picks reminded pauses ending today or on a missed day, with the server name', () => {
    const pauses = { 76: pause('2026-12-12'), 8: pause('2026-12-10'), 384: pause('2026-12-20') };
    expect(duePauseReminders(pauses, '2026-12-12')).toEqual([
      { providerId: 8, providerName: 'Netflix', resumeAt: '2026-12-10' },
      { providerId: 76, providerName: 'Viaplay', resumeAt: '2026-12-12' },
    ]);
  });

  it('ignores pauses without a reminder, malformed dates and unknown services', () => {
    const pauses = {
      76: pause('2026-12-12', false),
      8: pause('12/12/2026'),
      384: pause(null),
      999999: pause('2026-12-01'),
      337: 'nonsense',
      '08': pause('2026-12-01'),
    };
    expect(duePauseReminders(pauses, '2026-12-12')).toEqual([]);
    expect(duePauseReminders(null, '2026-12-12')).toEqual([]);
  });

  it('reads no more than MAX_PAUSES_READ entries of a crafted document', () => {
    const pauses: Record<string, unknown> = {};
    for (let i = 1; i <= MAX_PAUSES_READ + 5; i++) pauses[String(i)] = pause('2026-12-01');
    pauses['8'] = pause('2026-12-01');
    // Ids 1..35 are mostly unknown; only known ones within the first MAX read count.
    expect(duePauseReminders(pauses, '2026-12-12').length).toBeLessThanOrEqual(MAX_PAUSES_READ);
  });
});

describe('nextPauseReminderAfter', () => {
  it('is the earliest reminder left once the handled ones are cleared', () => {
    const pauses = { 76: pause('2026-12-12'), 8: pause('2026-12-10'), 384: pause('2027-01-05') };
    expect(nextPauseReminderAfter(pauses, [])).toBe('2026-12-10');
    expect(nextPauseReminderAfter(pauses, [8, 76])).toBe('2027-01-05');
    expect(nextPauseReminderAfter(pauses, [8, 76, 384])).toBeNull();
  });
});

describe('countFollowedAiring', () => {
  it('counts followed series on that service with an episode inside the window', () => {
    const series = [
      { subscriptionProviders: [76], nextAirDate: '2026-12-12' },
      { subscriptionProviders: [76, 8], nextAirDate: '2026-12-26' },
      { subscriptionProviders: [76], nextAirDate: '2026-12-27' }, // outside 14 days
      { subscriptionProviders: [8], nextAirDate: '2026-12-13' },  // other service
      { subscriptionProviders: [76], nextAirDate: '2026-12-11' }, // already aired
      { subscriptionProviders: [76], nextAirDate: null },
      {},
    ];
    expect(countFollowedAiring(series, 76, '2026-12-12')).toBe(2);
  });
});

describe('pauseReminderBody', () => {
  it('uses the approved wording, with singular and a plain line when nothing airs', () => {
    expect(pauseReminderBody('Viaplay', 2)).toBe('Viaplay har nytt igen: 2 serier du följer släpper avsnitt. Dags att starta om?');
    expect(pauseReminderBody('Viaplay', 1)).toBe('Viaplay har nytt igen: 1 serie du följer släpper avsnitt. Dags att starta om?');
    expect(pauseReminderBody('Viaplay', 0)).toBe('Viaplay: din paus tar slut i dag. Dags att starta om?');
  });
});
