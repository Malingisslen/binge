import { describe, it, expect } from 'vitest';
import { posterSrcSet } from './client';

describe('posterSrcSet (PERF-8)', () => {
  it('offers w185, w342 and w500 by default (title hero)', () => {
    expect(posterSrcSet('/p.jpg')).toBe(
      'https://image.tmdb.org/t/p/w185/p.jpg 185w, https://image.tmdb.org/t/p/w342/p.jpg 342w, https://image.tmdb.org/t/p/w500/p.jpg 500w',
    );
  });

  it('caps at w342 for grids, so no grid ever fetches a bigger poster than before', () => {
    expect(posterSrcSet('/p.jpg', 'w342')).not.toContain('w500');
    expect(posterSrcSet('/p.jpg', 'w342')).toContain('w185/p.jpg 185w');
  });

  it('returns undefined without a poster', () => {
    expect(posterSrcSet(null)).toBeUndefined();
  });
});
