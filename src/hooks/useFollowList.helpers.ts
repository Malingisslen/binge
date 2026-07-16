// Pure helpers for useFollowList — extracted so the row-mapping logic can be
// unit-tested without a React/Firebase harness.

export interface FollowListUser {
  uid: string;
  displayName: string;
  username: string | null;
  photoURL: string | null;
  isPublic: boolean;
}

// Cache value per uid:
// - FollowListUser : resolved projection card
// - null           : projection unreadable — private/not-a-friend, deleted
//                    account, or fetch error → show the fallback row
// - undefined      : not fetched yet → show fallback row until resolved
//
// BIN-505/BIN-522: the old 'ghost' variant (drop deleted accounts on read) is
// gone. users/{uid} is owner-locked, so the projection read can no longer
// distinguish "deleted" from "private" — both come back null and render as the
// fallback row. Genuine dangling follow docs from deleted accounts are reaped
// by the weekly reclaimOrphanFollows sweep instead of being dropped on read.
export type FollowProfile = FollowListUser | null;

export function followFallback(uid: string): FollowListUser {
  return { uid, displayName: 'Privat användare', username: null, photoURL: null, isPublic: false };
}

// Maps follow uids to display rows in order. Unreadable (null) and unfetched
// (cache miss) uids render as an anonymous fallback row — never dropped, so a
// follower count and its visible rows always agree.
export function resolveFollowRows(
  uids: readonly string[],
  cache: ReadonlyMap<string, FollowProfile>,
): FollowListUser[] {
  return uids.map(uid => cache.get(uid) ?? followFallback(uid));
}
