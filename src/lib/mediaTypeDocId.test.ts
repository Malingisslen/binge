import { describe, it, expect } from 'vitest';
import {
  mediaTypeDocId,
  normalizeMediaType,
  parseTmdbIdFromDocId,
  parseMediaTypeFromDocId,
  resolveTmdbId,
} from './mediaTypeDocId';

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

describe('parseMediaTypeFromDocId (STRICT inverse — null when unattributable)', () => {
  it('recovers the type from a namespaced id', () => {
    expect(parseMediaTypeFromDocId('movie_123')).toBe('movie');
    expect(parseMediaTypeFromDocId('tv_123')).toBe('tv');
  });
  it('returns null for a bare legacy id (genuinely unattributable — NOT defaulted to tv)', () => {
    expect(parseMediaTypeFromDocId('123')).toBeNull();
    expect(parseMediaTypeFromDocId('')).toBeNull();
    expect(parseMediaTypeFromDocId('season_5')).toBeNull();
  });
  it('round-trips with mediaTypeDocId', () => {
    expect(parseMediaTypeFromDocId(mediaTypeDocId('movie', 7))).toBe('movie');
    expect(parseMediaTypeFromDocId(mediaTypeDocId('tv', 7))).toBe('tv');
  });
});

describe('resolveTmdbId (field-or-parse, the one canonical resolver)', () => {
  it('prefers the stored field over the doc id', () => {
    expect(resolveTmdbId(603, 'movie_999')).toBe(603);
  });
  it('parses the doc id when the field is absent', () => {
    expect(resolveTmdbId(null, 'movie_999')).toBe(999);
    expect(resolveTmdbId(undefined, 'tv_42')).toBe(42);
    expect(resolveTmdbId(null, '123')).toBe(123);
  });
  it('coerces a numeric-string stored field ("603" → 603)', () => {
    expect(resolveTmdbId('603', 'anything')).toBe(603);
  });
  it('falls through an empty/whitespace/zero field to the doc id — no phantom id-0', () => {
    expect(resolveTmdbId('', 'tv_500')).toBe(500);
    expect(resolveTmdbId('   ', 'tv_500')).toBe(500);
    expect(resolveTmdbId(0, 'tv_7')).toBe(7);
    expect(Number.isNaN(resolveTmdbId('', 'garbage'))).toBe(true);
  });
  it('returns NaN when neither source yields a number', () => {
    expect(Number.isNaN(resolveTmdbId(null, 'garbage'))).toBe(true);
    expect(Number.isNaN(resolveTmdbId(undefined, 'movie_'))).toBe(true);
  });
});
