import { describe, it, expect } from 'vitest';
import {
  localIsoDate, toIsoDate, todayIso, addDaysFromToday,
  formatSwedishDate, formatEpisodeCode, pluralSv, daysBetween,
} from './utils';

describe('localIsoDate / toIsoDate — local calendar, not UTC', () => {
  // Dates built from explicit LOCAL components. The correct (local) helper
  // returns those exact components in every timezone. The old UTC-based
  // `toISOString().slice(0,10)` would report the previous day for these
  // local times in UTC+ zones (e.g. 01:30 in Sweden) — this is the BIN-39 bug.
  // NOTE: these catch a revert to toISOString() when run in a UTC+ timezone
  // (e.g. a Stockholm dev machine). On a UTC CI runner local==UTC so the buggy
  // and fixed code agree; to make CI a hard regression guard, run the suite
  // with TZ=Europe/Stockholm.
  it('keeps the local date for an early-morning local time (UTC+ off-by-one case)', () => {
    expect(localIsoDate(new Date(2026, 0, 15, 1, 30))).toBe('2026-01-15');
  });

  it('keeps the local date for a late-evening local time (UTC- off-by-one case)', () => {
    expect(localIsoDate(new Date(2026, 11, 31, 23, 0))).toBe('2026-12-31');
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
