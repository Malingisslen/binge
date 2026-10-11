export const MAX_SOCIAL_FANOUT = 30;

export type SocialRelation = 'friend' | 'following';

export interface SocialTarget {
  uid: string;
  relation: SocialRelation;
}

// Friends go first so the cap never pushes a mutual relationship out in favour of
// a one-way follow; a friend I also follow is listed once, as a friend.
export function buildSocialTargets(
  friendUids: readonly string[],
  followingUids: readonly string[],
  blockedUids: ReadonlySet<string>,
  cap: number = MAX_SOCIAL_FANOUT,
): SocialTarget[] {
  const seen = new Set<string>();
  const out: SocialTarget[] = [];
  const add = (uid: string, relation: SocialRelation) => {
    if (blockedUids.has(uid) || seen.has(uid)) return;
    seen.add(uid);
    out.push({ uid, relation });
  };
  for (const u of friendUids) add(u, 'friend');
  for (const u of followingUids) add(u, 'following');
  return out.slice(0, cap);
}

// Sorted so the cache key does not change when only the order of the lists does.
// The relation is part of the key because a follow that becomes a friendship changes
// the label on the result without changing who is asked.
export function socialTargetsKey(targets: readonly SocialTarget[]): string {
  return targets.map(t => `${t.uid}:${t.relation}`).sort().join(',');
}
