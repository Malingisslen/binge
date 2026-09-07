import { describe, it, expect } from 'vitest';

import {
  pickGroupSuccessor,
  buildHandoverUpdate,
  clearsAddedBy,
  type MemberRow,
} from './logic';

const member = (uid: string, joinedAtMs: number | null): MemberRow => ({ uid, joinedAtMs });

/** The ordinary case: every member row corresponds to a live `memberUids` entry. */
const rollOf = (members: readonly MemberRow[], leavingUid: string) =>
  members.map((m) => m.uid).filter((uid) => uid !== leavingUid);

describe('pickGroupSuccessor — who inherits the group', () => {
  // The trap this ticket is most exposed to, and it wears the shape of the
  // NORMAL group rather than an edge case: createGroup writes the owner's own
  // member document before anyone else can join, so the owner's joinedAt is the
  // earliest in essentially every group that exists. A picker that forgets to
  // exclude the departing uid elects them, hands the group back to a deleted
  // account, and reports success.
  it('never elects the departing owner, even though they joined first', () => {
    const members = [
      member('owner', 1000),
      member('early', 2000),
      member('late', 3000),
    ];
    expect(pickGroupSuccessor(members, 'owner', rollOf(members, 'owner'))).toBe('early');
  });

  // The fixture that actually PINS the exclusion above. Every other picker case
  // hands in an eligible list the leaver is already missing from, so the
  // eligibility filter alone would satisfy them and the exclusion could be
  // deleted with the whole suite green. A real caller holds the group document's
  // memberUids as it reads BEFORE the handover write lands — the departing owner
  // still in it. That is this list.
  it('excludes the departing owner even when the eligible list still names them', () => {
    const members = [
      member('owner', 1000),
      member('early', 2000),
      member('late', 3000),
    ];
    expect(pickGroupSuccessor(members, 'owner', ['owner', 'early', 'late'])).toBe('early');
  });

  it('picks the earliest joiner among the members who remain', () => {
    // Deliberately NOT in joinedAt order: a picker that takes the first element
    // of the array (or of a query result) passes an ordered fixture and fails
    // this one.
    const members = [
      member('late', 5000),
      member('owner', 100),
      member('earliest', 2000),
      member('middle', 3000),
    ];
    expect(pickGroupSuccessor(members, 'owner', rollOf(members, 'owner'))).toBe('earliest');
  });

  it('returns null when nobody remains', () => {
    expect(pickGroupSuccessor([member('owner', 1000)], 'owner', [])).toBeNull();
    expect(pickGroupSuccessor([], 'owner', [])).toBeNull();
  });

  // The member rows are not the access list. `firestore.rules` decides membership
  // from the group document's `memberUids`; `members/*` is written by a different
  // branch. Someone who leaves through a raw array write strands their
  // own member row and can no longer delete it — the self branch of selfOrOwner()
  // requires membership — so the row survives with the earliest joinedAt among
  // non-owners. Electing from the rows alone would hand the group to a stranger
  // the rules no longer treat as a member, who as ownerUid could then evict
  // everyone and delete it.
  it('never elects a member row that is absent from memberUids', () => {
    const members = [
      member('owner', 100),
      member('stranded', 200),
      member('real', 900),
    ];
    expect(pickGroupSuccessor(members, 'owner', ['real'])).toBe('real');
  });

  it('returns null when no surviving memberUid has a member row', () => {
    const members = [member('owner', 100), member('stranded', 200)];
    expect(pickGroupSuccessor(members, 'owner', ['someone-with-no-row'])).toBeNull();
  });

  // Without a defined tie-break the successor would depend on the order Firestore
  // happened to return the documents in.
  it('breaks a tie on the lowest uid, not on read order', () => {
    const forward = [member('owner', 10), member('bea', 500), member('alva', 500)];
    const reversed = [...forward].reverse();
    expect(pickGroupSuccessor(forward, 'owner', ['bea', 'alva'])).toBe('alva');
    expect(pickGroupSuccessor(reversed, 'owner', ['bea', 'alva'])).toBe('alva');
  });

  // An absent value must never read as "joined before everyone".
  it('ranks a member with no joinedAt below every member who has one', () => {
    // The uids are deliberately ordered AGAINST the expected answer. With names
    // that happened to sort the right way, dropping the stamped/unstamped split
    // still passed this case through the uid tie-break — green for the wrong
    // reason, and blind to exactly the mutation it was written to catch.
    const members = [
      member('owner', 10),
      member('aaa-unstamped', null),
      member('zzz-stamped', 9000),
    ];
    expect(pickGroupSuccessor(members, 'owner', ['aaa-unstamped', 'zzz-stamped']))
      .toBe('zzz-stamped');
  });

  // NaN survives a bare `!== null` check, and both `a < b` and `a > b` are false
  // for it — so a corrupt value would win or lose depending on the order the rows
  // arrived in. Same uid ordering trick: the corrupt row sorts first by uid, so a
  // picker that admits it to the stamped pool elects it.
  it('treats a non-finite joinedAt as unstamped rather than as earliest', () => {
    const members = [
      member('owner', 10),
      member('aaa-corrupt', Number.NaN),
      member('zzz-real', 9000),
    ];
    expect(pickGroupSuccessor(members, 'owner', ['aaa-corrupt', 'zzz-real'])).toBe('zzz-real');
  });

  it('still hands over when NO remaining member has a joinedAt', () => {
    // Deleting other people's shared data because a field is missing is the
    // worse of the two failures. Lowest uid, deterministically.
    const members = [member('owner', 10), member('zoe', null), member('bo', null)];
    expect(pickGroupSuccessor(members, 'owner', ['zoe', 'bo'])).toBe('bo');
  });

  it('is stable regardless of the order the members arrive in', () => {
    const members = [
      member('owner', 1),
      member('a', 400),
      member('b', 200),
      member('c', null),
    ];
    const roll = rollOf(members, 'owner');
    const shuffles = [
      members,
      [...members].reverse(),
      [members[2], members[0], members[3], members[1]],
    ];
    for (const shuffle of shuffles) {
      expect(pickGroupSuccessor(shuffle, 'owner', roll)).toBe('b');
    }
  });
});

describe('buildHandoverUpdate — the write, and when there must not be one', () => {
  const members = [member('owner', 100), member('heir', 200), member('other', 300)];

  it('names the successor as owner and shrinks memberUids by exactly the leaver', () => {
    const update = buildHandoverUpdate('owner', 'owner', members, ['owner', 'heir', 'other']);
    expect(update).toEqual({ kind: 'handover', ownerUid: 'heir', memberUids: ['heir', 'other'] });
  });

  // The eligibility intersection has to happen INSIDE the builder, not be left to
  // whichever caller remembers it. Here the earliest non-owner row is stranded —
  // no longer in memberUids — so the group must go to the member who is.
  it('elects from the surviving memberUids, never from the member rows alone', () => {
    const stranded = [member('owner', 100), member('stranded', 150), member('real', 800)];
    const update = buildHandoverUpdate('owner', 'owner', stranded, ['owner', 'real']);
    expect(update).toEqual({ kind: 'handover', ownerUid: 'real', memberUids: ['real'] });
  });

  // The idempotency guard. A retried sweep must find its own earlier handover
  // already done and do nothing — never hold a second election, which could name
  // a different member than the first run did.
  // The two refusals must be TELLABLE APART, not merely both falsy. A caller that
  // reads "no handover" as "delete the group" would destroy a live group on a
  // retried sweep that had already succeeded.
  it('reports noop, not delete, when ownerUid has already moved', () => {
    expect(buildHandoverUpdate('heir', 'owner', members, ['heir', 'other']))
      .toEqual({ kind: 'noop' });
  });

  it('reports delete when nobody remains', () => {
    expect(buildHandoverUpdate('owner', 'owner', [member('owner', 100)], ['owner']))
      .toEqual({ kind: 'delete' });
  });

  it('reports delete when every surviving memberUid lacks a member row', () => {
    expect(buildHandoverUpdate('owner', 'owner', members, ['owner', 'ghost']))
      .toEqual({ kind: 'delete' });
  });
});

describe('clearsAddedBy — the departed name goes, the title stays', () => {
  it('clears only the departing uid', () => {
    expect(clearsAddedBy('gone', 'gone')).toBe(true);
    expect(clearsAddedBy('someone-else', 'gone')).toBe(false);
  });

  it('leaves a row that carries no addedBy alone', () => {
    expect(clearsAddedBy(undefined, 'gone')).toBe(false);
    expect(clearsAddedBy(null, 'gone')).toBe(false);
  });
});
