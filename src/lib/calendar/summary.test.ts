import { describe, it, expect } from 'vitest';
import { countEntries, summarizeCounts } from './summary';
import type { EpisodeEntry, MovieEntry, CalendarEntry } from './types';

function episode(p: Partial<EpisodeEntry> = {}): EpisodeEntry {
  return {
    kind: 'episode', mediaType: 'tv', tmdbId: 1, title: 'S',
    posterPath: null, backdropPath: null, airDate: '2026-06-20',
    season: 1, episode: 1, episodeCode: 'S1E1', ...p,
  };
}

function movie(p: Partial<MovieEntry> = {}): MovieEntry {
  return {
    kind: 'movie', mediaType: 'movie', releaseType: 'digital',
    tmdbId: 2, title: 'M', posterPath: null, backdropPath: null, airDate: '2026-06-20', ...p,
  };
}

describe('countEntries', () => {
  it('counts episodes, movies, premieres and finales', () => {
    const entries: CalendarEntry[] = [
      episode({ isPremiere: true }),
      episode({ isFinale: true }),
      episode(),
      movie(),
    ];
    expect(countEntries(entries)).toEqual({
      episodes: 3, movies: 1, premieres: 1, finales: 1, premiereFinales: 0, total: 4,
    });
  });

  it('counts an episode that is both premiere and finale in premiereFinales', () => {
    const entries: CalendarEntry[] = [episode({ isPremiere: true, isFinale: true })];
    expect(countEntries(entries)).toEqual({
      episodes: 1, movies: 0, premieres: 1, finales: 1, premiereFinales: 1, total: 1,
    });
  });
});

describe('summarizeCounts', () => {
  it('renders a dash for an empty day', () => {
    expect(summarizeCounts([])).toBe('—');
  });
  it('pluralises and joins episodes + movies', () => {
    expect(summarizeCounts([episode()])).toBe('1 avsnitt');
    expect(summarizeCounts([movie(), movie()])).toBe('2 filmer');
    expect(summarizeCounts([episode(), episode(), movie()])).toBe('2 avsnitt · 1 film');
  });
});
