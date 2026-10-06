import { describe, it, expect } from 'vitest';
import { ratingDistribution } from './ratingDistribution';

describe('ratingDistribution', () => {
  it('lägger ett halvt steg i stapeln under', () => {
    expect(ratingDistribution([4.5, 4, 5])).toEqual({ '4': 2, '5': 1 });
  });

  it('räknar 0,5 i stapeln för 1', () => {
    expect(ratingDistribution([0.5, 1, 1.5])).toEqual({ '1': 3 });
  });

  it('summerar till lika många som antalet betyg', () => {
    const ratings = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
    const total = Object.values(ratingDistribution(ratings)).reduce((a, b) => a + b, 0);
    expect(total).toBe(ratings.length);
  });
});
