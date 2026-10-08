import { describe, it, expect } from 'vitest';
import { PRICE_STALE_DAYS, formatPriceDay, formatPriceMonth, parseIsoDay, priceFreshness } from './priceFreshness';

// #28:s villkor 10: saknat, felformat eller för gammalt datum.
const NOW = new Date(2026, 9, 5, 14, 0); // 5 okt 2026 lokal tid

describe('priceFreshness', () => {
  it('a missing date is unverified', () => {
    expect(priceFreshness(undefined, NOW)).toEqual({ kind: 'unverified' });
  });

  it.each(['', '2026-7-2', '02-07-2026', '2026-02-30', '2026-13-01', 'igår', '2026-07-02T00:00:00Z'])(
    'a malformed date (%j) is unverified',
    (bad) => {
      expect(priceFreshness(bad, NOW)).toEqual({ kind: 'unverified' });
    },
  );

  it('a future date is unverified', () => {
    expect(priceFreshness('2026-10-06', NOW)).toEqual({ kind: 'unverified' });
  });

  it("today's date is fresh, even late in the day in a UTC+ timezone", () => {
    expect(priceFreshness('2026-10-05', new Date(2026, 9, 5, 0, 30))).toEqual({ kind: 'fresh', date: '2026-10-05' });
  });

  it('exactly PRICE_STALE_DAYS old is still fresh; one day more is stale', () => {
    const edge = new Date(2026, 9, 5 - PRICE_STALE_DAYS);
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(priceFreshness(iso(edge), NOW).kind).toBe('fresh');
    const older = new Date(2026, 9, 4 - PRICE_STALE_DAYS);
    expect(priceFreshness(iso(older), NOW)).toEqual({ kind: 'stale', date: iso(older) });
  });

  it('a date half a year old is stale', () => {
    expect(priceFreshness('2026-04-01', NOW).kind).toBe('stale');
  });
});

describe('parseIsoDay', () => {
  it('rejects a day that does not exist instead of rolling it over', () => {
    expect(parseIsoDay('2026-02-30')).toBeNull();
    expect(parseIsoDay('2026-02-28')).not.toBeNull();
  });
});

describe('formatting', () => {
  it('formats a day without locale APIs', () => {
    expect(formatPriceDay('2026-07-02')).toBe('2 jul 2026');
    expect(formatPriceDay(undefined)).toBe('–');
    expect(formatPriceDay('nonsens')).toBe('–');
  });

  it('formats a month from either date form', () => {
    expect(formatPriceMonth('2026-09')).toBe('sep 2026');
    expect(formatPriceMonth('2026-05-15')).toBe('maj 2026');
    expect(formatPriceMonth('2026-13')).toBe('–');
  });
});
