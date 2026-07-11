import { describe, it, expect } from 'vitest';
import {
  seDigitalReleaseDates,
  releasesDigitallyToday,
  stockholmDateString,
  type TmdbReleaseDatesCountry,
} from './logic';

const se = (types: { type: number; date: string }[]): TmdbReleaseDatesCountry[] => [
  { iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2026-07-11T00:00:00.000Z' }] },
  { iso_3166_1: 'SE', release_dates: types.map((t) => ({ type: t.type, release_date: t.date })) },
];

describe('seDigitalReleaseDates', () => {
  it('returns SE type-4 dates as YYYY-MM-DD', () => {
    expect(seDigitalReleaseDates(se([{ type: 4, date: '2026-07-11T00:00:00.000Z' }]))).toEqual(['2026-07-11']);
  });

  it('ignores non-SE country blocks (US type-4 must not leak in)', () => {
    // Only the US block has a type-4; SE has none → empty.
    const results = seDigitalReleaseDates([
      { iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2026-07-11T00:00:00.000Z' }] },
    ]);
    expect(results).toEqual([]);
  });

  it('ignores non-digital (non-type-4) SE entries', () => {
    expect(seDigitalReleaseDates(se([
      { type: 3, date: '2026-07-11T00:00:00.000Z' }, // theatrical
      { type: 5, date: '2026-08-01T00:00:00.000Z' }, // physical
    ]))).toEqual([]);
  });

  it('collects and dedups MULTIPLE type-4 SE entries (not just [0])', () => {
    const dates = seDigitalReleaseDates(se([
      { type: 4, date: '2026-07-11T00:00:00.000Z' },
      { type: 4, date: '2026-07-11T09:00:00.000Z' }, // same calendar day, different time → dedup
      { type: 4, date: '2026-07-18T00:00:00.000Z' }, // a second distinct digital date
    ]));
    expect(dates.sort()).toEqual(['2026-07-11', '2026-07-18']);
  });

  it('uses the STATED calendar date, not a timezone-shifted instant', () => {
    // A TMDB release_date is a calendar date; the time component is noise. A
    // 22:00Z entry means "the 11th", so it must resolve to the 11th — NOT roll
    // forward to the 12th via a timezone conversion (the over-correction the 2nd
    // xhigh review caught). "Today" is where the timezone matters; see the
    // stockholmDateString tests below.
    expect(seDigitalReleaseDates(se([{ type: 4, date: '2026-07-11T22:00:00.000Z' }]))).toEqual(['2026-07-11']);
  });

  it('skips obviously-truncated date strings (length guard)', () => {
    expect(seDigitalReleaseDates(se([{ type: 4, date: '2026' }]))).toEqual([]);
  });

  it('zero entries / missing results → empty (no-op, not a throw)', () => {
    expect(seDigitalReleaseDates([])).toEqual([]);
    expect(seDigitalReleaseDates(null)).toEqual([]);
    expect(seDigitalReleaseDates(undefined)).toEqual([]);
    expect(seDigitalReleaseDates(se([]))).toEqual([]);
  });
});

describe('releasesDigitallyToday', () => {
  it('fires when a type-4 SE date equals today', () => {
    expect(releasesDigitallyToday(se([{ type: 4, date: '2026-07-11T00:00:00.000Z' }]), '2026-07-11')).toBe(true);
  });

  it('does not fire when the only SE date is not today', () => {
    expect(releasesDigitallyToday(se([{ type: 4, date: '2026-07-18T00:00:00.000Z' }]), '2026-07-11')).toBe(false);
  });

  it('fires if ANY of several type-4 entries equals today', () => {
    expect(releasesDigitallyToday(se([
      { type: 4, date: '2026-06-01T00:00:00.000Z' },
      { type: 4, date: '2026-07-11T00:00:00.000Z' },
    ]), '2026-07-11')).toBe(true);
  });

  it('zero type-4 entries → never fires', () => {
    expect(releasesDigitallyToday(se([{ type: 3, date: '2026-07-11T00:00:00.000Z' }]), '2026-07-11')).toBe(false);
  });
});

describe('stockholmDateString — DST-safe calendar boundary', () => {
  // Fall-back anchor (reference_dst_test_anchor): late-October, when Sweden is on
  // CET (UTC+1). An instant at 23:30 UTC is already 00:30 the NEXT day in Sweden,
  // so a naive UTC-date read would be a day behind. Autumn CET (not summer CEST)
  // keeps the +1h offset unambiguous.
  it('rolls to the Swedish calendar day, not the UTC day, past local midnight', () => {
    // 2026-10-26T23:30:00Z → 2026-10-27 00:30 in Europe/Stockholm (CET, UTC+1).
    expect(stockholmDateString(new Date('2026-10-26T23:30:00Z'))).toBe('2026-10-27');
  });

  it('agrees with UTC when the instant is mid-day', () => {
    expect(stockholmDateString(new Date('2026-07-11T10:00:00Z'))).toBe('2026-07-11');
  });
});
