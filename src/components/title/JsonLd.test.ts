import { describe, it, expect } from 'vitest';
import { reviewSchema, type ReviewSchemaInput } from './JsonLd';

const base: ReviewSchemaInput = {
  id: 'r1', authorName: 'Anna', reviewBody: 'Riktigt bra.', rating: 8,
  itemName: 'Dune', itemType: 'Movie', itemUrl: 'https://binge.nu/movie/438631/',
};

describe('reviewSchema', () => {
  it('builds a Review embedded in itemReviewed', () => {
    const s = reviewSchema(base);
    expect(s['@type']).toBe('Review');
    expect(s.reviewBody).toBe('Riktigt bra.');
    expect(s.author).toEqual({ '@type': 'Person', name: 'Anna' });
    expect(s.itemReviewed).toEqual({ '@type': 'Movie', name: 'Dune', url: 'https://binge.nu/movie/438631/' });
  });
  it('maps a 0–10 rating to reviewRating with bestRating 10', () => {
    expect(reviewSchema(base).reviewRating).toEqual({ '@type': 'Rating', ratingValue: 8, bestRating: 10, worstRating: 1 });
  });
  it('omits reviewRating when rating is null', () => {
    expect(reviewSchema({ ...base, rating: null }).reviewRating).toBeUndefined();
  });
  it('supports TVSeries itemType', () => {
    const s = reviewSchema({ ...base, itemType: 'TVSeries', itemName: 'Severance' });
    expect((s.itemReviewed as Record<string, unknown>)['@type']).toBe('TVSeries');
  });
  it('falls back to "Anonym" when authorName is empty', () => {
    expect(reviewSchema({ ...base, authorName: '' }).author).toEqual({ '@type': 'Person', name: 'Anonym' });
  });
});
