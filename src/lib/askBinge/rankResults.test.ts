import { describe, it, expect } from 'vitest';
import { rankAskResults } from './rankResults';
import type { RowTitle } from '@/types';

const t = (id: number, vote_average: number, vote_count: number, popularity = 0): RowTitle =>
  ({ id, media_type: 'movie', vote_average, vote_count, popularity } as unknown as RowTitle);

describe('rankAskResults', () => {
  it('ranks by a popularity score (rating × log votes) by default', () => {
    // low rating but huge vote count beats a high rating with almost no votes
    const blockbuster = t(1, 7.5, 20000);
    const obscureGem = t(2, 9.5, 30);
    const ranked = rankAskResults([obscureGem, blockbuster]);
    expect(ranked.map((r) => r.id)).toEqual([1, 2]);
  });

  it('ranks by rating first when the user asked for "högst betyg"', () => {
    const blockbuster = t(1, 7.5, 20000);
    const obscureGem = t(2, 9.5, 30);
    const ranked = rankAskResults([blockbuster, obscureGem], 'vote_average.desc');
    expect(ranked.map((r) => r.id)).toEqual([2, 1]);
  });

  it('breaks rating ties by vote count, so a single-vote 9 cannot top a well-voted 9', () => {
    const wellVoted = t(1, 9.0, 5000);
    const thinlyVoted = t(2, 9.0, 60);
    const ranked = rankAskResults([thinlyVoted, wellVoted], 'vote_average.desc');
    expect(ranked.map((r) => r.id)).toEqual([1, 2]);
  });

  it('does not mutate the input array', () => {
    const input = [t(1, 7, 10), t(2, 8, 10)];
    const copy = [...input];
    rankAskResults(input, 'vote_average.desc');
    expect(input).toEqual(copy);
  });
});
