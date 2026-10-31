import { describe, it, expect } from 'vitest';
import { isEpisodeSeen, episodeCodeLabel } from './episodeDigest';

describe('isEpisodeSeen', () => {
  it('is false without any logged progress', () => {
    expect(isEpisodeSeen(undefined, 1, 1)).toBe(false);
    expect(isEpisodeSeen({ lastWatchedSeason: null, lastWatchedEpisode: null }, 1, 1)).toBe(false);
  });
  it('is true at the episode or later, false before', () => {
    expect(isEpisodeSeen({ lastWatchedSeason: 2, lastWatchedEpisode: 5 }, 2, 5)).toBe(true);
    expect(isEpisodeSeen({ lastWatchedSeason: 3, lastWatchedEpisode: 1 }, 2, 9)).toBe(true);
    expect(isEpisodeSeen({ lastWatchedSeason: 2, lastWatchedEpisode: 4 }, 2, 5)).toBe(false);
  });
  it('formats the code with two digits', () => {
    expect(episodeCodeLabel(2, 5)).toBe('S02E05');
  });
});
