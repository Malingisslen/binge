import { describe, it, expect } from 'vitest';
import { isWatchableBy, whoCanWatch } from './watchable';

const cand = (providers: number[]) => ({ providers });

describe('isWatchableBy', () => {
  it('intersect: requires every participant to have one of the title\'s services', () => {
    const people = [{ providers: [8, 337] }, { providers: [337] }];
    expect(isWatchableBy(cand([337]), people, 'intersect')).toBe(true);
    expect(isWatchableBy(cand([8]), people, 'intersect')).toBe(false);
  });

  it('intersect: a title on two services works when each person has a different one', () => {
    const people = [{ providers: [8] }, { providers: [337] }];
    expect(isWatchableBy(cand([8, 337]), people, 'intersect')).toBe(true);
  });

  it('union: one participant is enough', () => {
    const people = [{ providers: [8] }, { providers: [337] }];
    expect(isWatchableBy(cand([8]), people, 'union')).toBe(true);
    expect(isWatchableBy(cand([119]), people, 'union')).toBe(false);
  });

  it('intersect: a participant with no services blocks every tagged title', () => {
    const people = [{ providers: [8] }, { providers: [] }];
    expect(isWatchableBy(cand([8]), people, 'intersect')).toBe(false);
  });

  it('keeps untagged titles from older sessions', () => {
    expect(isWatchableBy(cand([]), [{ providers: [8] }], 'intersect')).toBe(true);
  });
});

describe('whoCanWatch', () => {
  it('names the participants who have one of the services', () => {
    const people = [
      { displayName: 'Anna', providers: [8] },
      { displayName: 'Erik', providers: [337] },
    ];
    expect(whoCanWatch(cand([8]), people)).toEqual(['Anna']);
  });

  it('says nothing for a title without service data', () => {
    expect(whoCanWatch(cand([]), [{ displayName: 'Anna', providers: [8] }])).toEqual([]);
  });
});
