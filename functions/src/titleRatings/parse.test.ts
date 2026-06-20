import { describe, it, expect } from 'vitest';
import { parseOmdbRatings, isFresh } from './parse';

describe('parseOmdbRatings', () => {
  it('parses a full OMDb response', () => {
    const json = {
      Response: 'True',
      imdbRating: '8.4',
      imdbVotes: '1,234,567',
      Metascore: '82',
      Ratings: [
        { Source: 'Internet Movie Database', Value: '8.4/10' },
        { Source: 'Rotten Tomatoes', Value: '91%' },
        { Source: 'Metacritic', Value: '82/100' },
      ],
    };
    expect(parseOmdbRatings(json)).toEqual({
      imdb: { score: 8.4, votes: 1234567 },
      rottenTomatoes: 91,
      metacritic: 82,
    });
  });

  it('returns nulls when Response is False', () => {
    expect(parseOmdbRatings({ Response: 'False', Error: 'Not found!' })).toEqual({
      imdb: null, rottenTomatoes: null, metacritic: null,
    });
  });

  it('handles missing RT/Metacritic gracefully (common for Nordic titles)', () => {
    const json = { Response: 'True', imdbRating: '7.1', imdbVotes: '900', Metascore: 'N/A', Ratings: [
      { Source: 'Internet Movie Database', Value: '7.1/10' },
    ] };
    expect(parseOmdbRatings(json)).toEqual({
      imdb: { score: 7.1, votes: 900 }, rottenTomatoes: null, metacritic: null,
    });
  });

  it('treats imdbRating "N/A" as null imdb', () => {
    expect(parseOmdbRatings({ Response: 'True', imdbRating: 'N/A', imdbVotes: 'N/A' }).imdb).toBeNull();
  });

  it('returns nulls for non-object input', () => {
    expect(parseOmdbRatings(null)).toEqual({ imdb: null, rottenTomatoes: null, metacritic: null });
  });
});

describe('isFresh', () => {
  const now = Date.parse('2026-06-20T00:00:00Z');
  it('fresh within TTL', () => {
    expect(isFresh(now - 10 * 86_400_000, now, 45)).toBe(true);
  });
  it('stale past TTL', () => {
    expect(isFresh(now - 50 * 86_400_000, now, 45)).toBe(false);
  });
});
