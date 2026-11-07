// ADR 0029: pure rules for the household page, kept apart from React and Firebase so they
// can be tested on their own.
import type { HouseholdContribution, HouseholdWatchingTitle } from '@/lib/advisor/householdAggregate';
import type { Group } from '@/types';

/** The same cap the rules put on a household's members. */
export const HOUSEHOLD_MAX_MEMBERS = 6;

/** Name used when a household is created with one press; the owner can rename it. */
export const DEFAULT_HOUSEHOLD_NAME = 'Hemma';

/** A user lives in at most one household. If old data ever holds more, the oldest wins so
 *  the answer does not jump between visits. */
export function findMyHousehold(groups: readonly Group[]): Group | null {
  const households = groups.filter(g => g.kind === 'household');
  if (households.length === 0) return null;
  return [...households].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
}

export type HouseholdInviteState =
  /** No button: not my household to invite into, not a confirmed friend, or myself. */
  | 'hidden'
  /** I have no household yet; the button offers to create one first. */
  | 'create-first'
  | 'member'
  | 'full'
  | 'invite';

/** What the "Bjud in till hushållet" button on a friend's page should do. */
export function householdInviteState(params: {
  household: Group | null;
  myUid: string | null;
  targetUid: string;
  isFriend: boolean;
}): HouseholdInviteState {
  const { household, myUid, targetUid, isFriend } = params;
  if (!myUid || myUid === targetUid || !isFriend) return 'hidden';
  if (!household) return 'create-first';
  if (household.ownerUid !== myUid) return 'hidden';
  if (household.memberUids.includes(targetUid)) return 'member';
  if (household.memberUids.length >= HOUSEHOLD_MAX_MEMBERS) return 'full';
  return 'invite';
}

/** The consent text promises the first name, not the full display name. */
export function firstName(displayName: string | undefined): string {
  const first = (displayName ?? '').trim().split(/\s+/)[0];
  return first || 'Medlem';
}

export interface HouseholdWatchingRow {
  uid: string;
  name: string;
  titles: HouseholdWatchingTitle[];
}

/** "Ni tittar på": one row per member who shared titles and has at least one, in the order
 *  the contributions came. A member who has not shared under the household text is absent.
 *  Someone I have blocked is absent too, because blocking does not remove them from the household. */
export function householdWatchingRows(
  contributions: readonly Pick<HouseholdContribution, 'uid' | 'watchingNow'>[],
  names: Readonly<Record<string, string>>,
  blockedUids: ReadonlySet<string> = new Set(),
): HouseholdWatchingRow[] {
  return contributions
    .filter(c => !blockedUids.has(c.uid))
    .filter(c => c.watchingNow !== undefined && c.watchingNow.length > 0)
    .map(c => ({ uid: c.uid, name: firstName(names[c.uid]), titles: c.watchingNow! }));
}
