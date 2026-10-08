import { describe, it, expect } from 'vitest';
import { sanitizeStored } from './RecommendationsFilters';
import { DEFAULT_SHARED_FILTERS } from '@/lib/filters/titleFilters';

describe('sanitizeStored (Rekommendationers sparade filter)', () => {
  const clean = { ...DEFAULT_SHARED_FILTERS, mediaType: 'all', country: '', sort: 'relevance' };

  it('a value saved by the old filter bar reads back as the defaults, without a crash', () => {
    expect(sanitizeStored({ decade: '1990', voteAverageMin: 7, genre: '35', myProvidersOnly: true })).toEqual(clean);
  });

  it('keeps known choices and drops unknown ones', () => {
    expect(sanitizeStored({ mediaType: 'tv', country: 'SE', sort: 'rating', minStars: 4 }))
      .toEqual({ ...clean, mediaType: 'tv', country: 'SE', sort: 'rating', minStars: 4 });
    expect(sanitizeStored({ mediaType: 'radio', country: 'XX', sort: 'random' })).toEqual(clean);
  });
});
