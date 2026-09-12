import { describe, it, expect } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  pickGroupSuccessor,
  buildHandoverUpdate,
  clearsAddedBy,
  isEmptyExcept,
  refusalForHandover,
  refusalForSentInvites,
  SENT_INVITE_BATCH_LIMIT,
  HANDOVER_PARTIAL,
  memberTraceWrites,
  chunkWrites,
  type MemberRow,
  type TraceWrite,
} from './logic';
import { eraseSentInvites, type TraceErasure } from './runHandover';

// Paths from this file rather than from the working directory.
// It was `process.cwd()` until BIN-1110: the build config compiled test files as
// CommonJS, where `import.meta` is a compile error, and the only thing that said so
// was `firebase deploy --only functions` — last of all, by hand. The build no longer
// compiles them and tsconfig.typecheck.json reads them as the ESM vitest actually
// runs, so the honest form is available again. Anchoring on the file rather than on
// the working directory also means the test cannot pass by reading the wrong tree.
const HERE = join(fileURLToPath(import.meta.url), '..');
const REPO = join(HERE, '..', '..', '..');
/** The callable, with `//` comments stripped, so a scan reads code not prose. */
const ENTRY = readFileSync(join(HERE, 'index.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
/** The loop, same treatment — it declares the erasure's field set. */
const LOOP = readFileSync(join(HERE, 'runHandover.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
/** The pure logic, same treatment — it builds the group document's own handover write. */
const LOGIC = readFileSync(join(HERE, 'logic.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
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

describe('isEmptyExcept — the one spelling of "nobody but them is left"', () => {
  // The sweep asks this twice: once when it PLANS which groups it may delete,
  // once immediately before deleting each one. Two spellings is how one drifts,
  // and the two answers decide whether a live third party's group is deleted or
  // an empty one is kept forever.
  it('is true when only the leaver is listed', () => {
    expect(isEmptyExcept(['gone'], 'gone')).toBe(true);
  });

  it('is true for an empty list, which is the shape a missing field leaves', () => {
    expect(isEmptyExcept([], 'gone')).toBe(true);
  });

  it('is false as soon as anybody else is listed', () => {
    expect(isEmptyExcept(['gone', 'keeper'], 'gone')).toBe(false);
    expect(isEmptyExcept(['keeper'], 'gone')).toBe(false);
  });

  // A duplicate entry must not read as a survivor — a group whose list carries
  // the leaver twice is still empty of everyone else.
  it('is true when the leaver appears more than once', () => {
    expect(isEmptyExcept(['gone', 'gone'], 'gone')).toBe(true);
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
    // BIN-1147 split the Io out into a variable so the erasure and the handover
    // share one handle. The claim is unchanged and now covers BOTH consumers:
    // each is handed the auth-derived uid, and the port is the Admin one.
    expect(ENTRY).toContain('const io = adminHandoverIo(getFirestore(), logger);');
    expect(ENTRY).toContain('eraseSentInvites(io, uid)');
    expect(ENTRY).toContain('runGroupHandover(io, uid)');
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
    // Raised 2 -> 4 when BIN-1140 gave the group document its own hasOnly, and
    // 4 -> 5 when BIN-1155 gave the MEMBER document one, which pins `uid` against the
    // path segment. Lowering it is the deliberate act a shrink has to perform out loud.
    //
    // The floor earned its keep on that second raise: BIN-1155's first draft carried an
    // awk pattern in a rules COMMENT whose braces did not balance, which closed the
    // brace scan above early and shrank the derived set to three. Nothing else in the
    // file would have said so.
    expect(uidFieldsInRules.size).toBeGreaterThanOrEqual(5);
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

  // The second way a uid field is dealt with, and the reason this map exists at all.
  // BIN-1140/1128 gave the group DOCUMENT its own `hasOnly`, and the scan above reads
  // the whole groups tree — so `ownerUid` and `memberUids` started arriving in the
  // derived set. They are not row erasures and never were: the departing owner's uid
  // leaves the group document by being REPLACED with the successor's, in the same
  // write. Declaring them here keeps the roster requirement honest in both directions
  // — a new uid field still has to be classified as one or the other and cannot pass
  // by being neither — where widening the scan's exclusion would have made the group
  // document permanently unwatched.
  const HANDOVER_EXPRESSION: Record<string, string> = {
    ownerUid: 'ownerUid: successorUid',
    memberUids: 'memberUids: survivors',
  };

  // The third way, added by BIN-1155. `groups/{gid}/members/{uid}` gained its own
  // `hasOnly`, which pins the row's `uid` field against the path segment — so the scan
  // now derives `uid`. It is neither erased field-by-field nor handed over: the whole
  // ROW goes, which is strictly more than clearing one field on it. Declaring it keeps
  // the roster requirement honest rather than teaching the scan to look away, the same
  // reasoning HANDOVER_EXPRESSION above carries.
  const ROW_DELETED_EXPRESSION: Record<string, string> = {
    uid: "{ op: 'delete', collection: 'members', doc: leavingUid }",
  };

  it('a uid field on a row that is deleted whole is covered by that delete', () => {
    // Pinned on the delete EXPRESSION, not on the field name: `uid` occurs all over
    // the row types it is read from, so a name check would stay green with the delete
    // ripped out.
    for (const expr of Object.values(ROW_DELETED_EXPRESSION)) {
      expect(LOGIC, `the member row is no longer deleted (\`${expr}\`)`).toContain(expr);
    }
  });

  it('the group document\'s own uid fields are handed over, not merely named', () => {
    // Pinned on the expressions in buildHandoverUpdate, not on the field names: the
    // names occur in the row types they are read from, so a `toContain(field)` would
    // stay green with the handover ripped out.
    for (const expr of Object.values(HANDOVER_EXPRESSION)) {
      expect(LOGIC, `the handover no longer writes \`${expr}\``).toContain(expr);
    }
  });

  it('the derived set and the declared handlers are the same set, both ways', () => {
    const declared = [
      ...Object.keys(ERASURE_EXPRESSION),
      ...Object.keys(HANDOVER_EXPRESSION),
      ...Object.keys(ROW_DELETED_EXPRESSION),
    ];
    // → A new uid field in a group contract has no handler here and fails.
    for (const field of uidFieldsInRules) {
      expect(declared, `${field} is pinned by firestore.rules but has no handler`)
        .toContain(field);
    }
    // ← A handler for a field the rules no longer pin is dead weight, except the
    // one that is deliberately not derivable.
    for (const field of declared) {
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

// BIN-1109. The batching used to live inside the Admin-SDK port, where no test could reach
// it: every test port implemented the method as ONE unbroken batch, so `flush()` never ran
// anywhere and the split's own correctness was asserted by nothing. A group needs more than
// ~448 rows before it even splits, and no group exists in production, so nothing had gone
// wrong — but "nothing has gone wrong yet" and "this is checked" are different claims.
describe('memberTraceWrites', () => {
  const erasure = (over: Partial<TraceErasure> = {}): TraceErasure => ({
    itemIds: [],
    clearAddedByIds: [],
    clearPickedByIds: [],
    dropParticipantIds: [],
    ...over,
  });

  // The three unconditional deletes come first and are the whole erasure for a member who
  // touched nothing. A group row and a household row survive a departure otherwise, and the
  // joinAttempts row holds a plaintext invite token (BIN-329).
  it('always erases the member row, the household row and the join attempt', () => {
    expect(memberTraceWrites('U9', erasure())).toEqual([
      { op: 'delete', collection: 'members', doc: 'U9' },
      { op: 'delete', collection: 'household', doc: 'U9' },
      { op: 'delete', collection: 'joinAttempts', doc: 'U9' },
    ]);
  });

  // The nested path is written as one collection string rather than walked. Pinned by VALUE
  // because a wrong path here deletes nothing and reports success — the shape of failure
  // this whole ticket family is about.
  it('reaches per-item progress at watchlist/{itemId}/progress', () => {
    const writes = memberTraceWrites('U9', erasure({ itemIds: ['IT1', 'IT2'] }));
    expect(writes.slice(3)).toEqual([
      { op: 'delete', collection: 'watchlist/IT1/progress', doc: 'U9' },
      { op: 'delete', collection: 'watchlist/IT2/progress', doc: 'U9' },
    ]);
  });

  // Each field-clearing category names the field it touches. A write that named the wrong
  // field would erase a bystander's data, so these are pinned by value too.
  it('names the exact field for every clear and drop', () => {
    const writes = memberTraceWrites('U9', erasure({
      clearAddedByIds: ['IT1'],
      clearPickedByIds: ['S1'],
      dropParticipantIds: ['S2'],
    }));
    expect(writes.slice(3)).toEqual([
      { op: 'clear', collection: 'watchlist', doc: 'IT1', field: 'addedBy' },
      { op: 'clear', collection: 'sessionHistory', doc: 'S1', field: 'pickedByUid' },
      { op: 'drop', collection: 'sessionHistory', doc: 'S2', field: 'participantUids' },
    ]);
  });

  // The ORDER across categories, not only within one. Both this function's docstring and
  // the port's comment say the list is "in the order they must be made", and a per-category
  // fixture cannot see a reordering: with one category populated the order is trivially
  // right, and a test that checks only lengths is blind by construction. Order decides
  // which chunk a write lands in, so it decides what survives a commit that fails partway.
  it('keeps the categories in the order the port commits them', () => {
    expect(memberTraceWrites('U9', erasure({
      itemIds: ['IT1'],
      clearAddedByIds: ['IT2'],
      clearPickedByIds: ['S1'],
      dropParticipantIds: ['S2'],
    }))).toEqual([
      { op: 'delete', collection: 'members', doc: 'U9' },
      { op: 'delete', collection: 'household', doc: 'U9' },
      { op: 'delete', collection: 'joinAttempts', doc: 'U9' },
      { op: 'delete', collection: 'watchlist/IT1/progress', doc: 'U9' },
      { op: 'clear', collection: 'watchlist', doc: 'IT2', field: 'addedBy' },
      { op: 'clear', collection: 'sessionHistory', doc: 'S1', field: 'pickedByUid' },
      { op: 'drop', collection: 'sessionHistory', doc: 'S2', field: 'participantUids' },
    ]);
  });

  // Every id the caller hands over must appear exactly once. A category dropped from the
  // builder is invisible to a test that only counts the total.
  it('emits one write per id, with no category dropped', () => {
    const writes = memberTraceWrites('U9', erasure({
      itemIds: ['A', 'B', 'C'],
      clearAddedByIds: ['A'],
      clearPickedByIds: ['S1', 'S2'],
      dropParticipantIds: ['S3'],
    }));
    expect(writes.length).toBe(3 + 3 + 1 + 2 + 1);
    expect(writes.filter((w) => w.collection === 'watchlist/B/progress')).toHaveLength(1);
    expect(writes.filter((w) => w.field === 'participantUids')).toHaveLength(1);
  });
});

describe('chunkWrites', () => {
  const w = (n: number) =>
    Array.from({ length: n }, (_, i): TraceWrite => ({
      op: 'delete',
      collection: 'members',
      doc: `U${i}`,
    }));

  // The decisive case: MORE writes than the ceiling. Nothing in the suite drove this before,
  // so a split that dropped the boundary write, or one that never reset its counter and so
  // left the second commit empty, would have passed everything.
  it('splits above the ceiling and loses nothing at the boundary', () => {
    const chunks = chunkWrites(w(1001), 450);
    expect(chunks.map((c) => c.length)).toEqual([450, 450, 101]);
    // Flattening must reproduce the input EXACTLY, in order — a boundary write silently
    // skipped is the half-erasure this guards against, and it is invisible to a length check
    // on the chunks alone.
    expect(chunks.flat()).toEqual(w(1001));
  });

  it('leaves a set at or under the ceiling in one commit', () => {
    expect(chunkWrites(w(450), 450)).toHaveLength(1);
    expect(chunkWrites(w(1), 450)).toHaveLength(1);
  });

  // An empty erasure must produce no commit at all, not one empty commit — a committed empty
  // batch is a billed write that does nothing.
  it('produces no commit for no writes', () => {
    expect(chunkWrites([], 450)).toEqual([]);
  });

  // A batching limit that is not a whole number at least one is a caller bug, and it must
  // be REFUSED rather than coerced: silently committing one write per batch would multiply
  // a large erasure's cost without anyone noticing. Deleting the refusal makes these red
  // rather than hanging the suite — see the floor beside the loop's advance for why.
  it('refuses a limit that is not a whole number of at least one', () => {
    expect(() => chunkWrites(w(3), 0)).toThrow(/at least 1/);
    expect(() => chunkWrites(w(3), -1)).toThrow(/at least 1/);
    expect(() => chunkWrites(w(3), 1.5)).toThrow(/at least 1/);
  });
});


describe('refusalForSentInvites — the ceiling refuses instead of half-erasing (BIN-1147)', () => {
  it('lets a count at the limit through', () => {
    expect(refusalForSentInvites(SENT_INVITE_BATCH_LIMIT)).toBeNull();
  });
  it('refuses one over the limit', () => {
    expect(refusalForSentInvites(SENT_INVITE_BATCH_LIMIT + 1)).not.toBeNull();
  });
  it('lets zero through', () => {
    expect(refusalForSentInvites(0)).toBeNull();
  });
  // The refusal must NOT carry the partial marker: it fires before anything is
  // written, so the caller's "nothing has been deleted" wording stays true.
  it('carries no partial marker', () => {
    expect(refusalForSentInvites(SENT_INVITE_BATCH_LIMIT + 1)).not.toContain(HANDOVER_PARTIAL);
  });
  it('stays under Firestore own 500-write batch ceiling', () => {
    expect(SENT_INVITE_BATCH_LIMIT).toBeLessThan(500);
  });
});

describe('eraseSentInvites — one atomic batch, or nothing (BIN-1147)', () => {
  const ioWith = (paths: readonly string[]) => {
    const deleted: string[][] = [];
    return {
      io: {
        sentInvitePaths: async () => paths,
        deleteSentInvites: async (p: readonly string[]) => { deleted.push([...p]); },
        log: { info: () => {}, error: () => {} },
      },
      deleted,
    };
  };

  it('deletes every found path in a SINGLE call', async () => {
    const { io, deleted } = ioWith(['users/a/groupInvites/g1', 'users/b/groupInvites/g2']);
    await expect(eraseSentInvites(io, 'me')).resolves.toEqual({ found: 2 });
    expect(deleted).toEqual([['users/a/groupInvites/g1', 'users/b/groupInvites/g2']]);
  });

  it('writes nothing when there is nothing to erase', async () => {
    const { io, deleted } = ioWith([]);
    await expect(eraseSentInvites(io, 'me')).resolves.toEqual({ found: 0 });
    expect(deleted).toEqual([]);
  });

  // The decisive case: over the ceiling it must write NOTHING, not a prefix.
  it('erases nothing at all when the count exceeds the ceiling', async () => {
    const many = Array.from({ length: SENT_INVITE_BATCH_LIMIT + 1 }, (_, i) => `users/u${i}/groupInvites/g`);
    const { io, deleted } = ioWith(many);
    await expect(eraseSentInvites(io, 'me')).rejects.toThrow(/Ingenting raderades/);
    expect(deleted).toEqual([]);
  });
});

describe('the callable erases sent invites BEFORE it hands over (BIN-1147)', () => {
  // Order is load-bearing: a refusal from the erasure must be a run that wrote
  // nothing, so the client's "nothing has been deleted" message stays true.
  // The entry point cannot be imported here (firebase-admin does not resolve
  // under the root runner), so the order is pinned by scanning its source.
  it('calls eraseSentInvites earlier in the entry point than runGroupHandover', () => {
    const erase = ENTRY.indexOf('eraseSentInvites(io');
    const handover = ENTRY.indexOf('runGroupHandover(io');
    expect(erase).toBeGreaterThan(-1);
    expect(handover).toBeGreaterThan(-1);
    expect(erase).toBeLessThan(handover);
  });

  // Position alone proves TEXT order, not that the erasure gates anything. Drop
  // the `await` and the two calls race: the refusal blocks nothing, the catch
  // becomes dead code an async rejection can never reach, and the whole suite
  // stayed green. So pin the await AND the wrap as ONE regex — an anchor on
  // either half alone survives the deletion of the other.
  it('awaits the erasure and wraps its refusal as an HttpsError', () => {
    expect(ENTRY).toMatch(
      /try \{\s*await eraseSentInvites\(io, uid\);\s*\} catch \(err\) \{\s*throw new HttpsError\('internal',/,
    );
  });
});
