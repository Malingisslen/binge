// Pure helpers for useFollowList — extracted so the ghost-filter logic can be
// unit-tested without a React/Firebase harness.

export interface FollowListUser {
  uid: string;
  displayName: string;
  username: string | null;
  photoURL: string | null;
  isPublic: boolean;
}

// Cache value per uid:
// - FollowListUser : resolved profile
// - null           : profile exists but is private / fetch errored → show fallback row
// - 'ghost'        : profile doc does NOT exist (deleted account) → drop the row
// - undefined      : not fetched yet → show fallback row until resolved
export type FollowProfile = FollowListUser | null | 'ghost';

export function followFallback(uid: string): FollowListUser {
  return { uid, displayName: 'Privat användare', username: null, photoURL: null, isPublic: false };
}

// Maps follow uids to display rows, dropping ghosts (deleted accounts whose
// profile doc is gone). This is the tombstone/lazy cleanup for BIN-21: account
// deletion can't remove the inbound follower/following mirror docs (they're
// owned by the other party), so dangling references are filtered out on read
// instead. Private/unfetched uids still render as a fallback row.
export function resolveFollowRows(
  uids: readonly string[],
  cache: ReadonlyMap<string, FollowProfile>,
): FollowListUser[] {
  const out: FollowListUser[] = [];
  for (const uid of uids) {
    const cached = cache.get(uid);
    if (cached === 'ghost') continue;
    out.push(cached ?? followFallback(uid));
  }
  return out;
}
