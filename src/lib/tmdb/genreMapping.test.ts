import { describe, it, expect } from 'vitest';
import { crossMediaGenreId } from './genreMapping';

describe('crossMediaGenreId', () => {
  it('same-type → passthrough (no remap)', () => {
    expect(crossMediaGenreId(28, 'movie', 'movie')).toBe(28);
    expect(crossMediaGenreId(10759, 'tv', 'tv')).toBe(10759);
  });

  it('maps known movie → TV genres', () => {
    expect(crossMediaGenreId(28, 'movie', 'tv')).toBe(10759);   // Action → Action & Adventure
    expect(crossMediaGenreId(878, 'movie', 'tv')).toBe(10765);  // Sci-Fi → Sci-Fi & Fantasy
    expect(crossMediaGenreId(10752, 'movie', 'tv')).toBe(10768); // War → War & Politics
  });

  it('maps known TV → movie genres', () => {
    expect(crossMediaGenreId(10759, 'tv', 'movie')).toBe(28);   // Action & Adventure → Action
    expect(crossMediaGenreId(10765, 'tv', 'movie')).toBe(878);  // Sci-Fi & Fantasy → Sci-Fi
    expect(crossMediaGenreId(10768, 'tv', 'movie')).toBe(10752); // War & Politics → War
  });

  it('returns null for genres with no cross-media equivalent', () => {
    expect(crossMediaGenreId(27, 'movie', 'tv')).toBeNull();    // Horror
    expect(crossMediaGenreId(53, 'movie', 'tv')).toBeNull();    // Thriller
    expect(crossMediaGenreId(10764, 'tv', 'movie')).toBeNull(); // Reality
    expect(crossMediaGenreId(10766, 'tv', 'movie')).toBeNull(); // Soap
  });

  it('returns null for an id not in the mapping table', () => {
    expect(crossMediaGenreId(99999, 'movie', 'tv')).toBeNull();
  });

  it('round-trips symmetric genres but NOT lossy ones (documents the asymmetry)', () => {
    // Action (28) ↔ Action & Adventure (10759) is a clean round trip.
    expect(crossMediaGenreId(crossMediaGenreId(28, 'movie', 'tv')!, 'tv', 'movie')).toBe(28);
    // Adventure (12) collapses into Action & Adventure → maps back to Action (28), not 12.
    expect(crossMediaGenreId(12, 'movie', 'tv')).toBe(10759);
    expect(crossMediaGenreId(10759, 'tv', 'movie')).toBe(28);
  });
});
