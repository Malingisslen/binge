import { describe, it, expect } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  pickGroupSuccessor,
  buildHandoverUpdate,
  clearsAddedBy,
  refusalForHandover,
  HANDOVER_PARTIAL,
  type MemberRow,
} from './logic';

// Paths from the repo root, not from `import.meta.url`. `functions/tsconfig.json`
// compiles `src` as CommonJS and includes test files, so `import.meta` here is a
// compile error that breaks `firebase deploy --only functions`, while vitest
// transpiles it happily. A wrong root throws on `readFileSync` rather than
// silently reading nothing.
const HERE = join(process.cwd(), 'functions', 'src', 'groupHandover');
const REPO = process.cwd();
/** The callable, with `//` comments stripped, so a scan reads code not prose. */
const ENTRY = readFileSync(join(HERE, 'index.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
/** The loop, same treatment — it declares the erasure's field set. */
const LOOP = readFileSync(join(HERE, 'runHandover.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
const RULES = readFileSync(join(REPO, 'firestore.rules'), 'utf8');

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

  // A uid in memberUids with no member row is a GHOST: the join is three separate
  // writes and can die between them. The rules count them in full — every
  // membership clause reads the array, none consults the row — so skipping them
  // would route the group to `delete` and destroy shared data for someone the
  // rules call a member. They rank as unstamped, not as absent.
  it('elects a ghost — in memberUids, no member row — over deleting the group', () => {
    const members = [member('owner', 100), member('stranded', 200)];
    expect(pickGroupSuccessor(members, 'owner', ['ghost'])).toBe('ghost');
  });

  it('ranks a ghost below a member who has a joinedAt', () => {
    // uid ordering against the expected answer, so the tie-break cannot rescue it.
    const members = [member('owner', 10), member('zzz-stamped', 9000)];
    expect(pickGroupSuccessor(members, 'owner', ['aaa-ghost', 'zzz-stamped']))
      .toBe('zzz-stamped');
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

  it('hands over to a ghost rather than deleting the group', () => {
    expect(buildHandoverUpdate('owner', 'owner', members, ['owner', 'ghost']))
      .toEqual({ kind: 'handover', ownerUid: 'ghost', memberUids: ['ghost'] });
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

describe('refusalForHandover — the caller must not fall through', () => {
  // The one thing standing between a group that failed to hand over and the
  // account cascade's owner branch, which deletes the WHOLE group — other
  // members' household data included — irreversibly.
  it('refuses when any group failed', () => {
    expect(refusalForHandover({ failed: 1, attempted: 0 })).toMatch(/Kunde inte lämna över/);
    expect(refusalForHandover({ failed: 9, attempted: 0 })).toMatch(/Kunde inte lämna över/);
  });

  it('allows the caller through only when nothing failed', () => {
    expect(refusalForHandover({ failed: 0, attempted: 0 })).toBeNull();
    // A run that wrote and did NOT fail is the ordinary success. It must not be
    // refused just because it touched something.
    expect(refusalForHandover({ failed: 0, attempted: 3 })).toBeNull();
  });

  // The difference the user reads. A failure after something was already written
  // is not "nothing has been deleted": ownership moved, the uid left memberUids,
  // rows were erased, and getting back in needs a fresh invite. Without the
  // marker the client's classifier falls to `untouched` and toasts exactly that
  // promise — the BIN-876 class one layer up.
  // Two declarations of one wire marker, on opposite sides of a boundary no
  // production code crosses. Nothing else holds them to each other, and a
  // divergence is silent: the client's classifier would fall to `untouched` and
  // toast the promise that nothing was deleted.
  it('the client declares the same marker', () => {
    const client = readFileSync(
      join(REPO, 'src', 'lib', 'firebase', 'groupHandover.ts'),
      'utf8',
    );
    expect(client).toContain(`export const HANDOVER_PARTIAL = '${HANDOVER_PARTIAL}';`);
  });

  // The client must OUTWAIT the server, not the other way round. `httpsCallable`
  // defaults to 70s and only loses its own race — it does not abort the request —
  // so a client that gives up first throws `deadline-exceeded` while the handover
  // runs on and usually finishes, and the user reads "Ingenting har raderats" over
  // writes that landed. Two numbers on opposite sides of a boundary with nothing
  // else holding them together.
  it('the client waits at least as long as the function is allowed to run', () => {
    // Comment-stripped like ENTRY: a future comment carrying a `timeout: <n>`
    // form would otherwise be matched first and satisfy this without the call
    // site setting anything.
    const client = readFileSync(
      join(REPO, 'src', 'lib', 'firebase', 'groupHandover.ts'),
      'utf8',
    ).replace(/^\s*\/\/.*$/gm, '');
    const clientMs = Number(/timeout:\s*([\d_]+)/.exec(client)?.[1].replace(/_/g, ''));
    const serverS = Number(/timeoutSeconds:\s*(\d+)/.exec(ENTRY)?.[1]);
    expect(clientMs, 'the client sets no explicit timeout').toBeGreaterThan(0);
    expect(serverS, 'the function sets no explicit timeoutSeconds').toBeGreaterThan(0);
    expect(clientMs).toBeGreaterThanOrEqual(serverS * 1000);
  });

  it('marks the refusal partial when a write was already attempted', () => {
    const partial = refusalForHandover({ failed: 1, attempted: 1 });
    expect(partial).toContain(HANDOVER_PARTIAL);
    const untouched = refusalForHandover({ failed: 1, attempted: 0 });
    expect(untouched).not.toContain(HANDOVER_PARTIAL);
  });

  // "The guard exists" and "the guard runs" are different claims, and the entry
  // point cannot be imported here (firebase-admin does not resolve under the root
  // runner). Anchor the whole block through its throw as ONE regex: an anchor on
  // the condition alone stays green while the body is deleted.
  it('is wired into the callable, throw and all', () => {
    expect(ENTRY).toMatch(
      /const refusal = refusalForHandover\(summary\);\s*if \(refusal\) \{\s*throw new HttpsError\('internal', refusal\);/,
    );
  });

  // The uid comes from the authenticated context, never the payload: a caller
  // can only ever hand over their OWN groups.
  it('takes the uid from request.auth and refuses without it', () => {
    expect(ENTRY).toContain('const uid = request.auth?.uid;');
    expect(ENTRY).toMatch(/if \(!uid\) throw new HttpsError\('unauthenticated'/);
    expect(ENTRY).toContain('runGroupHandover(adminIo(), uid)');
  });
});

describe('the erasure covers every uid-bearing field the group contracts pin', () => {
  // The roster requirement, and this batch is why it exists. `participantUids`
  // was missed by a hand-written enumeration and caught by a reviewer, not by a
  // test: nothing went red. The set is DERIVED from firestore.rules' own field
  // contracts rather than restated here, so a fifth uid field added to a group
  // subcollection fails this instead of shipping unerased.
  const uidFieldsInRules = (() => {
    // Brace-match the groups tree rather than slicing a guessed window: a window
    // that is too short silently drops subcollections, and the floor below is the
    // only thing that would notice.
    const header = 'match /groups/{groupId}';
    const start = RULES.indexOf(header);
    let depth = 0;
    let end = start;
    // Open the scan AFTER the path, whose own `{groupId}` is a brace pair that
    // would close the block on its first character.
    for (let i = RULES.indexOf('{', start + header.length); i < RULES.length; i += 1) {
      if (RULES[i] === '{') depth += 1;
      else if (RULES[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    const groupsTree = RULES.slice(start, end);
    const found = new Set<string>();
    for (const block of groupsTree.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)) {
      for (const name of block[1].matchAll(/'([A-Za-z0-9_]+)'/g)) {
        if (/uid/i.test(name[1])) found.add(name[1]);
      }
    }
    return found;
  })();

  // Without a floor the scan can break — a renamed rules block, a changed
  // `hasOnly` spelling — and report an empty set, which every subset assertion
  // below would satisfy. The guard would be inert and silent.
  it('the scan actually found fields', () => {
    expect(uidFieldsInRules.size).toBeGreaterThanOrEqual(2);
  });

  // How each field is erased, not merely that its name occurs somewhere. An
  // earlier draft asserted only `LOOP.toContain(field)` and stayed green when the
  // erasure was ripped out, because the field name still appeared in the row type
  // it was read from — the exact "passes for the wrong reason" shape.
  const ERASURE_EXPRESSION: Record<string, string> = {
    pickedByUid: 'clearsAddedBy(row.pickedByUid, leavingUid)',
    participantUids: 'row.participantUids.includes(leavingUid)',
    // Declared rather than derived. The scan reads `hasOnly` field contracts, and
    // `groups/{gid}/watchlist/{tmdbId}` has none — its create is membership-only —
    // so that collection is outside the scan's reach entirely, not merely its key.
    addedBy: 'clearsAddedBy(row.addedBy, leavingUid)',
  };

  it('the derived set and the declared handlers are the same set, both ways', () => {
    // → A new uid field in a group contract has no handler here and fails.
    for (const field of uidFieldsInRules) {
      expect(Object.keys(ERASURE_EXPRESSION), `${field} is pinned by firestore.rules but has no handler`)
        .toContain(field);
    }
    // ← A handler for a field the rules no longer pin is dead weight, except the
    // one that is deliberately not derivable.
    for (const field of Object.keys(ERASURE_EXPRESSION)) {
      if (field === 'addedBy') continue;
      expect([...uidFieldsInRules], `${field} has a handler but nothing pins it`).toContain(field);
    }
  });

  it('each declared handler is actually in the loop', () => {
    for (const [field, expression] of Object.entries(ERASURE_EXPRESSION)) {
      expect(LOOP, `${field} is no longer erased`).toContain(expression);
    }
  });
});
