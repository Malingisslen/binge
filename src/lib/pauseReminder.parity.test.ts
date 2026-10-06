import { describe, it, expect } from 'vitest';
import { nextPauseReminderDay } from './pauseReminder';
import { nextPauseReminderAfter } from '../../functions/src/rotationReminder/pauseReminder';
import type { ProviderPauseState } from '@/types';

// The client writes pauseReminderNext; the server reads it to find due users and
// recomputes it after sending. If the two disagree, a reminder is either never
// found or found every day. Both copies run against the same fixtures here.
const cases: Record<string, Record<number, ProviderPauseState>> = {
  none: {},
  oneReminded: { 76: { pausedAt: '2026-10-01', resumeAt: '2026-12-12', remind: true } },
  notReminded: { 76: { pausedAt: '2026-10-01', resumeAt: '2026-12-12' } },
  remindedFalse: { 76: { pausedAt: '2026-10-01', resumeAt: '2026-12-12', remind: false } },
  openEnded: { 76: { pausedAt: '2026-10-01', resumeAt: null, remind: true } },
  earliestWins: {
    76: { pausedAt: '2026-10-01', resumeAt: '2026-12-12', remind: true },
    8: { pausedAt: '2026-10-01', resumeAt: '2026-11-03', remind: true },
    384: { pausedAt: '2026-10-01', resumeAt: '2026-10-20' },
  },
  unknownService: { 999999: { pausedAt: '2026-10-01', resumeAt: '2026-10-20', remind: true } },
  aliasKey: { ['08' as unknown as number]: { pausedAt: '2026-10-01', resumeAt: '2026-10-20', remind: true } },
  badDate: { 76: { pausedAt: '2026-10-01', resumeAt: '20/10/2026', remind: true } },
};

describe('pauseReminderNext parity (BIN-1442)', () => {
  for (const [name, pauses] of Object.entries(cases)) {
    it(`client and server agree: ${name}`, () => {
      expect(nextPauseReminderDay(pauses)).toBe(nextPauseReminderAfter(pauses, []));
    });
  }

  it('gives the earliest reminded end date', () => {
    expect(nextPauseReminderDay(cases.earliestWins)).toBe('2026-11-03');
  });
});
