import { describe, it, expect } from 'vitest';
import { parseDayParam } from './dayParam';

describe('parseDayParam', () => {
  it('reads the week strip format as local midnight', () => {
    const d = parseDayParam('2026-10-08');
    expect(d).not.toBeNull();
    expect([d!.getFullYear(), d!.getMonth(), d!.getDate(), d!.getHours()]).toEqual([2026, 9, 8, 0]);
  });

  it('refuses a date that does not exist instead of rolling it into the next month', () => {
    expect(parseDayParam('2026-02-31')).toBeNull();
    expect(parseDayParam('2026-13-01')).toBeNull();
  });

  it('refuses anything that is not YYYY-MM-DD', () => {
    expect(parseDayParam(null)).toBeNull();
    expect(parseDayParam('')).toBeNull();
    expect(parseDayParam('8/10/2026')).toBeNull();
    expect(parseDayParam('2026-10-8')).toBeNull();
    expect(parseDayParam('2026-10-08T00:00')).toBeNull();
  });
});
