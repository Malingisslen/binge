import { describe, it, expect } from 'vitest';
import {
  findMyHousehold,
  firstName,
  householdInviteState,
  householdWatchingRows,
  HOUSEHOLD_MAX_MEMBERS,
} from './household';
import type { Group } from '@/types';

function group(over: Partial<Group> = {}): Group {
  return {
    id: 'h1', name: 'Hemma', ownerUid: 'me', memberUids: ['me'], kind: 'household',
    defaults: { providerMode: 'intersect', aggregation: 'least_misery', mediaType: 'both' },
    inviteTokenHash: null, inviteTokenRotatedAt: null,
    createdAt: new Date('2026-11-01'), updatedAt: new Date('2026-11-01'),
    ...over,
  };
}

describe('findMyHousehold', () => {
  it('ignores ordinary groups', () => {
    expect(findMyHousehold([group({ kind: null })])).toBeNull();
  });

  it('picks the oldest household when there is more than one', () => {
    const newer = group({ id: 'new', createdAt: new Date('2026-11-02') });
    const older = group({ id: 'old', createdAt: new Date('2026-10-01') });
    expect(findMyHousehold([newer, older])?.id).toBe('old');
  });
});

describe('householdInviteState', () => {
  const base = { myUid: 'me', targetUid: 'erik', isFriend: true };

  it('shows nothing for someone who is not a confirmed friend', () => {
    expect(householdInviteState({ ...base, household: group(), isFriend: false })).toBe('hidden');
  });

  it('shows nothing on my own page', () => {
    expect(householdInviteState({ ...base, household: group(), targetUid: 'me' })).toBe('hidden');
  });

  it('asks me to create a household first when I have none', () => {
    expect(householdInviteState({ ...base, household: null })).toBe('create-first');
  });

  it('shows nothing when I am in a household someone else owns, since only the owner invites', () => {
    expect(householdInviteState({ ...base, household: group({ ownerUid: 'anna', memberUids: ['anna', 'me'] }) })).toBe('hidden');
  });

  it('says the friend is already a member', () => {
    expect(householdInviteState({ ...base, household: group({ memberUids: ['me', 'erik'] }) })).toBe('member');
  });

  it('says the household is full at the cap', () => {
    const full = Array.from({ length: HOUSEHOLD_MAX_MEMBERS }, (_, i) => (i === 0 ? 'me' : `m${i}`));
    expect(householdInviteState({ ...base, household: group({ memberUids: full }) })).toBe('full');
  });

  it('the cap is the number the rules enforce on a household', () => {
    expect(HOUSEHOLD_MAX_MEMBERS).toBe(6);
  });

  it('offers the invitation with five members, one place left', () => {
    expect(householdInviteState({ ...base, household: group({ memberUids: ['me', 'a', 'b', 'c', 'd'] }) })).toBe('invite');
  });

  it('offers the invitation otherwise', () => {
    expect(householdInviteState({ ...base, household: group() })).toBe('invite');
  });
});

describe('firstName', () => {
  it('keeps only the first name', () => {
    expect(firstName('Erik Gisslén')).toBe('Erik');
  });
  it('falls back when no name is known', () => {
    expect(firstName(undefined)).toBe('Medlem');
    expect(firstName('   ')).toBe('Medlem');
  });
});

describe('householdWatchingRows', () => {
  const t = { id: 1399, type: 'tv' as const, title: 'Severance' };
  it('lists members who shared titles, with first names', () => {
    expect(householdWatchingRows([{ uid: 'erik', watchingNow: [t] }], { erik: 'Erik Gisslén' }))
      .toEqual([{ uid: 'erik', name: 'Erik', titles: [t] }]);
  });
  it('leaves out a member who has not shared titles or watches nothing', () => {
    expect(householdWatchingRows([{ uid: 'a' }, { uid: 'b', watchingNow: [] }], {})).toEqual([]);
  });
});
