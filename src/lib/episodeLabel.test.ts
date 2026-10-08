import { describe, it, expect } from 'vitest';
import { isGenericEpisodeName, formatNextEpisodeLabel, countAiredEpisodes, upcomingEpisode, seriesYearSpan } from './episodeLabel';

describe('isGenericEpisodeName', () => {
  it('detects Swedish generic names', () => {
    expect(isGenericEpisodeName('Avsnitt 1', 1)).toBe(true);
    expect(isGenericEpisodeName('avsnitt 12', 12)).toBe(true);
  });

  it('detects English generic names', () => {
    expect(isGenericEpisodeName('Episode 1', 1)).toBe(true);
    expect(isGenericEpisodeName('Episode #3', 3)).toBe(true);
  });

  it('does not flag real titles', () => {
    expect(isGenericEpisodeName('Pilot', 1)).toBe(false);
    expect(isGenericEpisodeName('Avsnittet om festen', 1)).toBe(false);
  });

  it('does not flag generic name for a different episode number', () => {
    expect(isGenericEpisodeName('Avsnitt 2', 1)).toBe(false);
  });
});

describe('formatNextEpisodeLabel', () => {
  it('drops the generic name — only code + date', () => {
    expect(formatNextEpisodeLabel({ season_number: 3, episode_number: 1, name: 'Avsnitt 1', air_date: '2026-07-02' }))
      .toBe('S3E1 (2026-07-02)');
  });

  it('keeps real episode titles', () => {
    expect(formatNextEpisodeLabel({ season_number: 2, episode_number: 5, name: 'The Engineer', air_date: '2026-07-02' }))
      .toBe('S2E5 — The Engineer (2026-07-02)');
  });

  it('handles missing air_date', () => {
    expect(formatNextEpisodeLabel({ season_number: 1, episode_number: 1, name: '', air_date: '' }))
      .toBe('S1E1');
  });
});

describe('countAiredEpisodes', () => {
  const eps = [
    { air_date: '2026-06-01' },
    { air_date: '2026-06-11' },
    { air_date: '2026-08-01' },
    { air_date: null },
    { air_date: '' },
  ];

  it('counts episodes aired today or earlier', () => {
    expect(countAiredEpisodes(eps, '2026-06-11')).toBe(2);
  });

  it('returns 0 when the whole season is in the future', () => {
    expect(countAiredEpisodes(eps, '2026-05-01')).toBe(0);
  });
});

describe('upcomingEpisode', () => {
  const ep = (air_date: string | null) => ({ air_date, episode_number: 1 });

  it('drops an episode whose date has passed', () => {
    expect(upcomingEpisode(ep('2026-08-16'), '2026-10-06')).toBeNull();
  });

  it('keeps an episode airing today or later', () => {
    expect(upcomingEpisode(ep('2026-10-06'), '2026-10-06')?.air_date).toBe('2026-10-06');
    expect(upcomingEpisode(ep('2026-10-20'), '2026-10-06')?.air_date).toBe('2026-10-20');
  });

  it('keeps an episode with no date, and passes null through', () => {
    expect(upcomingEpisode(ep(null), '2026-10-06')).not.toBeNull();
    expect(upcomingEpisode(null, '2026-10-06')).toBeNull();
  });
});

describe('seriesYearSpan', () => {
  it('shows one year for a series that ended the year it started', () => {
    expect(seriesYearSpan('2026-03-01', '2026-04-12', true)).toBe('2026');
  });

  it('shows a range for a series that ended a later year', () => {
    expect(seriesYearSpan('2019-01-01', '2023-05-01', true)).toBe('2019–2023');
  });

  it('leaves the range open for a running series', () => {
    expect(seriesYearSpan('2026-08-16', '2026-09-20', false)).toBe('2026–');
  });
});
