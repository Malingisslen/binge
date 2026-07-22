import { describe, it, expect } from 'vitest';
import { mediaTypeDocId, normalizeMediaType, parseTmdbIdFromDocId } from './mediaTypeDocId';

// Contract MUST match functions/src/shared/mediaTypeDocId.ts exactly — the two
// copies exist so client and server key a title's doc identically. If you change
// one, change the other (there is no shared import across the client/functions
// boundary).
describe('mediaTypeDocId (client mirror of the server helper)', () => {
  it('builds movie_/tv_ ids', () => {
    expect(mediaTypeDocId('movie', 42)).toBe('movie_42');
    expect(mediaTypeDocId('tv', 42)).toBe('tv_42');
  });

  it('passes a string tmdbId straight through (no lossy Number round-trip)', () => {
    expect(mediaTypeDocId('movie', '42')).toBe('movie_42');
  });

  it('normalizes unknown/blank mediaType to tv (server-parity default)', () => {
    expect(normalizeMediaType(undefined)).toBe('tv');
    expect(normalizeMediaType(null)).toBe('tv');
    expect(normalizeMediaType('')).toBe('tv');
    expect(normalizeMediaType('bogus')).toBe('tv');
    expect(mediaTypeDocId(undefined, 7)).toBe('tv_7');
  });

  it('only the exact string "movie" maps to movie', () => {
    expect(normalizeMediaType('movie')).toBe('movie');
    expect(normalizeMediaType('Movie')).toBe('tv'); // case-sensitive, matches server
  });
});

describe('parseTmdbIdFromDocId (robust across the mixed-format transition)', () => {
  it('recovers the id from a bare legacy doc id', () => {
    expect(parseTmdbIdFromDocId('123')).toBe(123);
  });
  it('recovers the id from a namespaced doc id (the NaN-landmine case)', () => {
    expect(parseTmdbIdFromDocId('movie_123')).toBe(123);
    expect(parseTmdbIdFromDocId('tv_123')).toBe(123);
    // A bare Number() here would be NaN — the exact bug this closes.
    expect(Number.isNaN(Number('tv_123'))).toBe(true);
  });
  it('round-trips with mediaTypeDocId', () => {
    expect(parseTmdbIdFromDocId(mediaTypeDocId('tv', 555))).toBe(555);
  });
  it('returns NaN for an unparseable id (callers guard with isFinite)', () => {
    expect(Number.isNaN(parseTmdbIdFromDocId('movie_abc'))).toBe(true);
  });
  it('returns NaN (not 0) for an empty numeric suffix — no phantom title-id-0', () => {
    // Number('') === 0 would sneak past isFinite; these must all be NaN.
    expect(Number.isNaN(parseTmdbIdFromDocId('movie_'))).toBe(true);
    expect(Number.isNaN(parseTmdbIdFromDocId('_'))).toBe(true);
    expect(Number.isNaN(parseTmdbIdFromDocId(''))).toBe(true);
  });
  it('returns NaN for an embedded-underscore numeric part (movie_1_2)', () => {
    expect(Number.isNaN(parseTmdbIdFromDocId('movie_1_2'))).toBe(true);
  });
});
