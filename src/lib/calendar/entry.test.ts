import { describe, it, expect } from 'vitest';
import { entryKey, entryHref, entryMetaLine, entryBadge, canMarkWatched } from './entry';
import type { EpisodeEntry, MovieEntry } from './types';

const episode: EpisodeEntry = {
  kind: 'episode', mediaType: 'tv', tmdbId: 100, title: 'Show',
  posterPath: null, backdropPath: null, airDate: '2026-06-20',
  season: 2, episode: 5, episodeCode: 'S2E5', isPremiere: false, isFinale: false,
};

const movie: MovieEntry = {
  kind: 'movie', mediaType: 'movie', releaseType: 'digital',
  tmdbId: 500, title: 'Film', posterPath: null, backdropPath: null, airDate: '2026-06-20',
};

describe('entry helpers', () => {
  it('entryKey distinguishes episodes from movies and avoids id collisions', () => {
    expect(entryKey(episode)).toBe('e-100-S2E5');
    expect(entryKey(movie)).toBe('m-500');
    expect(entryKey({ ...movie, tmdbId: 100 })).not.toBe(entryKey(episode));
  });

  it('entryHref points at the right title route', () => {
    expect(entryHref(episode)).toBe('/tv/100/');
    expect(entryHref(movie)).toBe('/movie/500/');
  });

  it('entryMetaLine shows episode code or lowercase "digital release"', () => {
    expect(entryMetaLine(episode)).toBe('S2E5');
    // Gemener för att matcha entryBadge/HemFocal (BIN-16).
    expect(entryMetaLine(movie)).toBe('digital release');
  });

  it('entryBadge reflects today, premiere and movie', () => {
    expect(entryBadge(episode, true)).toBe('ny ikväll');
    expect(entryBadge({ ...episode, isPremiere: true, season: 1 }, false)).toBe('premiär');
    expect(entryBadge({ ...episode, isPremiere: true, season: 3 }, false)).toBe('ny säsong');
    expect(entryBadge({ ...episode, isFinale: true }, false)).toBe('säsongsfinal');
    expect(entryBadge(movie, false)).toBe('digital release');
    expect(entryBadge(movie, true)).toBe('släpps i dag');
  });

  it('canMarkWatched for episodes, never for movie releases', () => {
    expect(canMarkWatched(episode)).toBe(true);
    expect(canMarkWatched(movie)).toBe(false);
  });
});
