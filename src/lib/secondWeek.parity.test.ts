import { describe, it, expect } from 'vitest';
import { isSecondWeekVisit as client } from './secondWeek';
import { isSecondWeekVisit as server, MIN_COHORT as serverMinCohort } from '../../functions/src/insights/secondWeek';
import { MIN_COHORT as clientMinCohort } from './secondWeek';

// The client stamps a visit; the server counts it. If the two windows differ, a
// stamped visit is not counted, or an account is never stamped at all (#22).
const created = new Date('2026-10-05T22:30:00Z'); // 00:30 on 6 Oct in Stockholm
const cases: [string, Date, boolean][] = [
  ['same day', new Date('2026-10-06T10:00:00Z'), false],
  ['day 6', new Date('2026-10-12T10:00:00Z'), false],
  ['day 7, first minute in Stockholm', new Date('2026-10-12T22:00:00Z'), true],
  ['day 13', new Date('2026-10-19T12:00:00Z'), true],
  ['day 14', new Date('2026-10-20T12:00:00Z'), false],
  ['across the DST change (25 Oct)', new Date('2026-10-26T12:00:00Z'), false],
];

describe('second-week window parity (BIN-1442)', () => {
  for (const [name, visit, expected] of cases) {
    it(`${name}: both say ${expected}`, () => {
      expect(client(created, visit)).toBe(expected);
      expect(server(created, visit)).toBe(expected);
    });
  }

  it('day 13 is still counted across the DST change', () => {
    const c = new Date('2026-10-20T10:00:00Z');
    const v = new Date('2026-11-02T10:00:00Z'); // 13 Stockholm days later, DST ended between
    expect(client(c, v)).toBe(true);
    expect(server(c, v)).toBe(true);
  });

  it('shares the "för få konton" floor with the server', () => {
    expect(clientMinCohort).toBe(serverMinCohort);
  });
});
