import { describe, it, expect } from 'vitest';
import { isGenericEpisodeName, formatNextEpisodeLabel, countAiredEpisodes } from './episodeLabel';

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
