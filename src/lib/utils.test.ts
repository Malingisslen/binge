import { describe, it, expect } from 'vitest';
import {
  localIsoDate, toIsoDate, todayIso, addDaysFromToday,
  formatSwedishDate, formatEpisodeCode, pluralSv, daysBetween,
} from './utils';

describe('localIsoDate / toIsoDate — local calendar, not UTC', () => {
  // Dates built from explicit LOCAL components. The correct (local) helper
  // returns those exact components in every timezone. The old UTC-based
  // `toISOString().slice(0,10)` reports the PREVIOUS day for local times in the
  // early-morning window [00:00, UTC-offset) of a UTC+ zone — this is the
  // BIN-39 bug.
  //
  // A day-flip under UTC+ only happens before the offset crosses midnight, so
  // the times below are picked to land inside that window for Europe/Stockholm:
  //   - winter (CET, UTC+1): 00:00–00:59 local flips back a day
  //   - summer (CEST, UTC+2): 00:00–01:59 local flips back a day
  // vitest.config.ts pins TZ=Europe/Stockholm so these run in a UTC+ zone even
  // on the UTC CI runner; with the local==UTC default they could not tell the
  // buggy and fixed code apart. (Verified by temporarily reverting to
  // toISOString() — both cases then go red.)
  it('keeps the local date for a winter early-morning time (CET off-by-one)', () => {
    // 00:30 CET = 23:30 UTC the previous day → toISOString() would say 01-14.
    expect(localIsoDate(new Date(2026, 0, 15, 0, 30))).toBe('2026-01-15');
  });

  it('keeps the local date for a summer early-morning time (CEST off-by-one)', () => {
    // 01:30 CEST = 23:30 UTC the previous day → toISOString() would say 07-08.
    expect(localIsoDate(new Date(2026, 6, 9, 1, 30))).toBe('2026-07-09');
  });

  it('zero-pads month and day', () => {
    expect(localIsoDate(new Date(2026, 2, 5, 12, 0))).toBe('2026-03-05');
  });

  it('toIsoDate matches the local calendar getters', () => {
    const d = new Date(2026, 6, 9, 8, 45);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(toIsoDate(d)).toBe(expected);
  });
});

describe('todayIso / addDaysFromToday', () => {
  it('todayIso equals the local calendar date of now', () => {
    expect(todayIso()).toBe(localIsoDate(new Date()));
  });

  it('addDaysFromToday(0) equals today', () => {
    expect(addDaysFromToday(0)).toBe(todayIso());
  });

  it('addDaysFromToday(N) advances N local days', () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    expect(addDaysFromToday(7)).toBe(localIsoDate(d));
  });
});

describe('formatSwedishDate', () => {
  it('returns the fallback for null', () => {
    expect(formatSwedishDate(null)).toBe('Okänt datum');
    expect(formatSwedishDate(null, 'TBD')).toBe('TBD');
  });

  it('labels the local today as "idag"', () => {
    expect(formatSwedishDate(todayIso())).toBe('idag');
  });

  it('formats a non-today date without saying "idag"', () => {
    expect(formatSwedishDate('2020-03-15')).not.toBe('idag');
  });
});

describe('formatEpisodeCode / pluralSv / daysBetween', () => {
  it('formats episode codes with zero-padding', () => {
    expect(formatEpisodeCode(1, 4)).toBe('S01E04');
    expect(formatEpisodeCode(12, 10)).toBe('S12E10');
  });

  it('pluralises by count', () => {
    expect(pluralSv(1, 'avsnitt', 'avsnitt')).toBe('1 avsnitt');
    expect(pluralSv(3, 'dag', 'dagar')).toBe('3 dagar');
  });

  it('daysBetween never goes negative and counts whole days', () => {
    const today = todayIso();
    expect(daysBetween(today)).toBe(0);
    const future = new Date();
    future.setDate(future.getDate() + 5);
    expect(daysBetween(today, future)).toBe(5);
  });
});
