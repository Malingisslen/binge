import { describe, it, expect } from 'vitest';
import { needsTmdbFieldsRefresh, TMDB_FIELDS_REFRESH_INTERVAL_MS } from './tmdbFieldsRefresh';

const NOW = Date.UTC(2026, 6, 11); // 2026-07-11

describe('needsTmdbFieldsRefresh', () => {
  it('refreshes when the stamp is absent (never stamped, or swept clean)', () => {
    expect(needsTmdbFieldsRefresh(null, NOW)).toBe(true);
    expect(needsTmdbFieldsRefresh(undefined, NOW)).toBe(true);
  });

  it('skips a freshly-stamped title (no write per view)', () => {
    const justNow = new Date(NOW - 60_000);
    expect(needsTmdbFieldsRefresh(justNow, NOW)).toBe(false);
  });

  it('skips a title stamped within the interval', () => {
    const stamp = new Date(NOW - (TMDB_FIELDS_REFRESH_INTERVAL_MS - 24 * 60 * 60 * 1000)); // 1 day inside
    expect(needsTmdbFieldsRefresh(stamp, NOW)).toBe(false);
  });

  it('refreshes once the stamp crosses the interval', () => {
    const stamp = new Date(NOW - (TMDB_FIELDS_REFRESH_INTERVAL_MS + 24 * 60 * 60 * 1000)); // 1 day past
    expect(needsTmdbFieldsRefresh(stamp, NOW)).toBe(true);
  });

  it('interval stays well under the 5-month sweep threshold (viewed titles are never swept)', () => {
    const SWEEP_THRESHOLD_MS = 5 * 30 * 24 * 60 * 60 * 1000;
    expect(TMDB_FIELDS_REFRESH_INTERVAL_MS).toBeLessThan(SWEEP_THRESHOLD_MS);
  });
});
