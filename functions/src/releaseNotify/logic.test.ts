import { describe, it, expect } from 'vitest';
import {
  seDigitalReleaseDates,
  releasesDigitallyToday,
  stockholmDateString,
  dayDiff,
  ymdToUtcMs,
  isWithinFireWindow,
  releaseDateToFire,
  shouldNotifyRelease,
  shouldRefetchReleaseDates,
  RELEASE_REFETCH_TTL_DAYS,
  RELEASE_CATCHUP_GRACE_DAYS,
  type ReleaseDateCache,
  type TmdbReleaseDatesCountry,
} from './logic';

const DAY = 86_400_000;

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

describe('dayDiff / ymdToUtcMs — calendar arithmetic', () => {
  it('counts whole days forward and backward', () => {
    expect(dayDiff('2026-07-11', '2026-07-11')).toBe(0);
    expect(dayDiff('2026-07-11', '2026-07-14')).toBe(3);
    expect(dayDiff('2026-07-14', '2026-07-11')).toBe(-3);
  });

  it('crosses a month/year boundary correctly', () => {
    expect(dayDiff('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('ymdToUtcMs is UTC midnight (no local-TZ drift)', () => {
    expect(ymdToUtcMs('2026-07-11')).toBe(Date.parse('2026-07-11T00:00:00.000Z'));
  });
});

describe('isWithinFireWindow — catch-up grace (BIN-464)', () => {
  it('fires on the exact day', () => {
    expect(isWithinFireWindow('2026-07-11', '2026-07-11', 3)).toBe(true);
  });

  it('fires within the grace window after release (missed cron days)', () => {
    expect(isWithinFireWindow('2026-07-11', '2026-07-14', 3)).toBe(true); // +3
  });

  it('does NOT fire past the grace window', () => {
    expect(isWithinFireWindow('2026-07-11', '2026-07-15', 3)).toBe(false); // +4
  });

  it('does NOT fire before the release date', () => {
    expect(isWithinFireWindow('2026-07-11', '2026-07-10', 3)).toBe(false);
  });
});

describe('releaseDateToFire — window pick + dedup key (BIN-464)', () => {
  it('returns the date when today is on it', () => {
    expect(releaseDateToFire(['2026-07-11'], '2026-07-11', 3)).toBe('2026-07-11');
  });

  it('returns the date during the catch-up window', () => {
    expect(releaseDateToFire(['2026-07-11'], '2026-07-13', 3)).toBe('2026-07-11');
  });

  it('returns null when nothing is in the window', () => {
    expect(releaseDateToFire(['2026-07-11'], '2026-07-20', 3)).toBeNull();
    expect(releaseDateToFire([], '2026-07-11', 3)).toBeNull();
  });

  it('prefers the LATEST in-window date (a newer digital date re-arms)', () => {
    expect(releaseDateToFire(['2026-07-11', '2026-07-13'], '2026-07-14', 3)).toBe('2026-07-13');
  });

  it('ignores a future date even if a past one is out of window', () => {
    expect(releaseDateToFire(['2026-07-01', '2026-08-01'], '2026-07-11', 3)).toBeNull();
  });
});

describe('shouldNotifyRelease — per-user dedup (BIN-464)', () => {
  it('notifies when no marker exists yet', () => {
    expect(shouldNotifyRelease(undefined, '2026-07-11')).toBe(true);
    expect(shouldNotifyRelease(null, '2026-07-11')).toBe(true);
  });

  it('suppresses a repeat for the same date (survives inbox deletion)', () => {
    expect(shouldNotifyRelease('2026-07-11', '2026-07-11')).toBe(false);
  });

  it('re-arms for a newer date', () => {
    expect(shouldNotifyRelease('2026-07-11', '2026-07-18')).toBe(true);
  });
});

describe('shouldRefetchReleaseDates — TMDB fetch cache (BIN-463)', () => {
  const opts = { ttlDays: RELEASE_REFETCH_TTL_DAYS, graceDays: RELEASE_CATCHUP_GRACE_DAYS };
  const now = Date.parse('2026-07-11T09:00:00Z');
  const today = '2026-07-11';

  it('refetches when there is no cache at all', () => {
    expect(shouldRefetchReleaseDates(null, today, now, opts)).toBe(true);
  });

  it('refetches when the cache was never resolved (null stamp)', () => {
    const c: ReleaseDateCache = { seDigitalDates: [], datesResolvedAtMs: null };
    expect(shouldRefetchReleaseDates(c, today, now, opts)).toBe(true);
  });

  it('trusts a fresh cache whose dates are far from today (SKIPS the fetch)', () => {
    const c: ReleaseDateCache = { seDigitalDates: ['2026-09-01'], datesResolvedAtMs: now - DAY };
    expect(shouldRefetchReleaseDates(c, today, now, opts)).toBe(false);
  });

  it('trusts a fresh EMPTY cache (film has no SE digital date — no daily re-fetch)', () => {
    const c: ReleaseDateCache = { seDigitalDates: [], datesResolvedAtMs: now - DAY };
    expect(shouldRefetchReleaseDates(c, today, now, opts)).toBe(false);
  });

  it('refetches once the cache is older than the TTL', () => {
    const c: ReleaseDateCache = {
      seDigitalDates: ['2026-09-01'],
      datesResolvedAtMs: now - (RELEASE_REFETCH_TTL_DAYS * DAY + DAY),
    };
    expect(shouldRefetchReleaseDates(c, today, now, opts)).toBe(true);
  });

  it('refetches (confirms live) when a cached date is inside the fire window', () => {
    const c: ReleaseDateCache = { seDigitalDates: ['2026-07-11'], datesResolvedAtMs: now - DAY };
    expect(shouldRefetchReleaseDates(c, today, now, opts)).toBe(true);
  });

  it('refetches on a future/skewed resolved stamp (distrust the clock)', () => {
    const c: ReleaseDateCache = { seDigitalDates: ['2026-09-01'], datesResolvedAtMs: now + DAY };
    expect(shouldRefetchReleaseDates(c, today, now, opts)).toBe(true);
  });

  it('grace ≥ TTL so a date first seen at a refetch is still fireable', () => {
    expect(RELEASE_CATCHUP_GRACE_DAYS).toBeGreaterThanOrEqual(RELEASE_REFETCH_TTL_DAYS);
  });
});
