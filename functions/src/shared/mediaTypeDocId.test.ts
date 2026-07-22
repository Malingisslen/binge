import { describe, it, expect } from 'vitest';
import { mediaTypeDocId, normalizeMediaType, parseTmdbIdFromDocId } from './mediaTypeDocId';

// Keep in lockstep with src/lib/mediaTypeDocId.test.ts (the client mirror). The
// two source helpers are byte-identical copies with no shared import, so this
// test pair is the ONLY drift net — it must exercise the same contract on both
// sides (null/blank/case + string passthrough), or a one-sided edit slips past.
describe('mediaTypeDocId', () => {
  it('builds movie_/tv_ ids', () => {
    expect(mediaTypeDocId('movie', 42)).toBe('movie_42');
    expect(mediaTypeDocId('tv', 42)).toBe('tv_42');
  });
  it('passes a string tmdbId straight through (no lossy Number round-trip)', () => {
    expect(mediaTypeDocId('movie', '42')).toBe('movie_42');
  });
  it('normalizes unknown/blank mediaType to tv (client-parity default)', () => {
    expect(normalizeMediaType(undefined)).toBe('tv');
    expect(normalizeMediaType(null)).toBe('tv');
    expect(normalizeMediaType('')).toBe('tv');
    expect(normalizeMediaType('bogus')).toBe('tv');
    expect(mediaTypeDocId('', 7)).toBe('tv_7');
  });
  it('only the exact string "movie" maps to movie (case-sensitive)', () => {
    expect(normalizeMediaType('movie')).toBe('movie');
    expect(normalizeMediaType('Movie')).toBe('tv');
  });
});

describe('parseTmdbIdFromDocId', () => {
  it('recovers the id from a bare legacy id', () => {
    expect(parseTmdbIdFromDocId('123')).toBe(123);
  });
  it('recovers the id from a namespaced id (NaN-landmine case)', () => {
    expect(parseTmdbIdFromDocId('movie_123')).toBe(123);
    expect(parseTmdbIdFromDocId('tv_123')).toBe(123);
  });
  it('round-trips with mediaTypeDocId', () => {
    expect(parseTmdbIdFromDocId(mediaTypeDocId('movie', 999))).toBe(999);
  });
  it('returns NaN for an unparseable id', () => {
    expect(Number.isNaN(parseTmdbIdFromDocId('tv_xyz'))).toBe(true);
  });
  it('returns NaN (not 0) for an empty suffix or embedded underscore', () => {
    expect(Number.isNaN(parseTmdbIdFromDocId('movie_'))).toBe(true);
    expect(Number.isNaN(parseTmdbIdFromDocId(''))).toBe(true);
    expect(Number.isNaN(parseTmdbIdFromDocId('tv_1_2'))).toBe(true);
  });
});
