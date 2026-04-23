import { describe, it, expect } from 'vitest';
import { statusLabel, STATUS_LABELS, MOVIE_STATUS_LABELS, tvShowStatusLabel } from './watchStatus';

describe('STATUS_LABELS', () => {
  it('contains all four WatchStatus values', () => {
    expect(STATUS_LABELS).toEqual({
      'följer': 'Följer',
      'vill_se': 'Vill se',
      'sedd': 'Sedd',
      'avbruten': 'Avbröt',
    });
  });
});

describe('MOVIE_STATUS_LABELS', () => {
  it('excludes "följer" (movies cannot be "following")', () => {
    expect(MOVIE_STATUS_LABELS).not.toHaveProperty('följer');
  });
  it('includes "vill_se", "sedd" and "avbruten"', () => {
    expect(MOVIE_STATUS_LABELS['vill_se']).toBe('Vill se');
    expect(MOVIE_STATUS_LABELS['sedd']).toBe('Sedd');
    expect(MOVIE_STATUS_LABELS['avbruten']).toBe('Avbröt');
  });
});

describe('statusLabel', () => {
  it('uses the generic label when mediaType is undefined', () => {
    expect(statusLabel('följer')).toBe('Följer');
    expect(statusLabel('vill_se')).toBe('Vill se');
  });

  it('uses the generic label for TV', () => {
    expect(statusLabel('följer', 'tv')).toBe('Följer');
    expect(statusLabel('sedd', 'tv')).toBe('Sedd');
  });

  it('uses the movie-specific label when mediaType is movie', () => {
    expect(statusLabel('vill_se', 'movie')).toBe('Vill se');
    expect(statusLabel('sedd', 'movie')).toBe('Sedd');
    expect(statusLabel('avbruten', 'movie')).toBe('Avbröt');
  });

  it('falls back to generic "Följer" when mediaType is movie — not expected but must not throw', () => {
    // följer is not in MOVIE_STATUS_LABELS, so it falls through to STATUS_LABELS
    expect(statusLabel('följer', 'movie')).toBe('Följer');
  });
});

describe('tvShowStatusLabel', () => {
  it('translates known TMDB statuses to Swedish', () => {
    expect(tvShowStatusLabel('Ended')).toBe('Avslutad');
    expect(tvShowStatusLabel('Returning Series')).toBe('Pågår');
    expect(tvShowStatusLabel('Canceled')).toBe('Inställd');
    expect(tvShowStatusLabel('In Production')).toBe('Under produktion');
  });

  it('returns the input verbatim for unknown TMDB statuses', () => {
    expect(tvShowStatusLabel('Rumored')).toBe('Rumored');
    expect(tvShowStatusLabel('Planned')).toBe('Planned');
    expect(tvShowStatusLabel('')).toBe('');
  });
});
