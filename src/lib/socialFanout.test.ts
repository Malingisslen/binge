import { describe, it, expect } from 'vitest';
import { buildSocialTargets, socialTargetsKey } from './socialFanout';

const none = new Set<string>();

describe('buildSocialTargets', () => {
  it('unites friends and follows and lists a friend I also follow once, as a friend', () => {
    const t = buildSocialTargets(['a', 'b'], ['b', 'c'], none);
    expect(t).toEqual([
      { uid: 'a', relation: 'friend' },
      { uid: 'b', relation: 'friend' },
      { uid: 'c', relation: 'following' },
    ]);
  });

  it('keeps friends under the cap even when follows are listed first in the input', () => {
    const follows = Array.from({ length: 10 }, (_, i) => `f${i}`);
    const t = buildSocialTargets(['x', 'y'], follows, none, 5);
    expect(t.map(x => x.uid)).toEqual(['x', 'y', 'f0', 'f1', 'f2']);
    expect(t.filter(x => x.relation === 'friend')).toHaveLength(2);
  });

  it('excludes blocked users from both lists', () => {
    const t = buildSocialTargets(['a', 'bad'], ['bad', 'c'], new Set(['bad']));
    expect(t.map(x => x.uid)).toEqual(['a', 'c']);
  });

  it('gives the same key regardless of list order', () => {
    const k1 = socialTargetsKey(buildSocialTargets(['a', 'b'], ['c'], none));
    const k2 = socialTargetsKey(buildSocialTargets(['b', 'a'], ['c'], none));
    expect(k1).toBe('a:friend,b:friend,c:following');
    expect(k2).toBe(k1);
  });

  it('gives a different key when a followed person becomes a friend', () => {
    const asFollow = socialTargetsKey(buildSocialTargets([], ['a'], none));
    const asFriend = socialTargetsKey(buildSocialTargets(['a'], ['a'], none));
    expect(asFriend).not.toBe(asFollow);
  });
});
