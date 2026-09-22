import { describe, it, expect } from 'vitest';
import { validateReportInput, isWithinCooldown, resolveTargetRef, resolveDocOwner, REPORT_NOTE_MAX, REPORT_ID_MAX } from './logic';

const base = {
  targetType: 'review',
  targetId: 'rev1',
  reason: 'spam',
};

describe('validateReportInput', () => {
  it('accepts a well-formed report and strips unknown/untrusted fields incl. targetOwnerUid', () => {
    // BIN-292: a client-sent targetOwnerUid must NOT survive into the validated
    // value — the callable derives the owner server-side. It's dropped like any
    // unknown field (alongside the forged reporterUid).
    const r = validateReportInput({ ...base, reporterUid: 'forged', targetOwnerUid: 'forged_owner', extra: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual(base); // reporterUid + targetOwnerUid + extra all dropped
    }
  });

  it('rejects non-object payloads', () => {
    expect(validateReportInput(null).ok).toBe(false);
    expect(validateReportInput('x').ok).toBe(false);
    expect(validateReportInput(undefined).ok).toBe(false);
  });

  it('rejects an invalid reason', () => {
    expect(validateReportInput({ ...base, reason: 'because' }).ok).toBe(false);
    expect(validateReportInput({ ...base, reason: 123 }).ok).toBe(false);
  });

  it('rejects an invalid targetType', () => {
    expect(validateReportInput({ ...base, targetType: 'episode' }).ok).toBe(false);
  });

  it('rejects missing/empty targetId', () => {
    expect(validateReportInput({ ...base, targetId: '' }).ok).toBe(false);
    expect(validateReportInput({ ...base, targetId: undefined }).ok).toBe(false);
  });

  it('rejects an oversized targetId (doc-bloat guard); exactly at the cap is accepted', () => {
    expect(validateReportInput({ ...base, targetId: 'x'.repeat(REPORT_ID_MAX + 1) }).ok).toBe(false);
    expect(validateReportInput({ ...base, targetId: 'x'.repeat(REPORT_ID_MAX) }).ok).toBe(true);
  });

  it('keeps a trimmed note and truncates to the max length', () => {
    const r = validateReportInput({ ...base, note: '  hej  ' });
    expect(r.ok && r.value.note).toBe('hej');
    const long = validateReportInput({ ...base, note: 'x'.repeat(REPORT_NOTE_MAX + 50) });
    expect(long.ok && long.value.note?.length).toBe(REPORT_NOTE_MAX);
  });

  it('drops an empty/whitespace note rather than storing it', () => {
    const r = validateReportInput({ ...base, note: '   ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect('note' in r.value).toBe(false);
  });

  it('rejects a non-string note', () => {
    expect(validateReportInput({ ...base, note: 42 }).ok).toBe(false);
  });
});

describe('resolveTargetRef (BIN-292 — server-side owner derivation)', () => {
  it('user → targetId IS the owner uid (no doc read needed)', () => {
    expect(resolveTargetRef('user', 'uid123')).toEqual({ kind: 'user', uid: 'uid123' });
  });
  it('review → reviews/{id} doc path, owner under `uid`', () => {
    expect(resolveTargetRef('review', 'rev1'))
      .toEqual({ kind: 'doc', path: ['reviews', 'rev1'], ownerField: 'uid' });
  });
  it('list → lists/{id} doc path, owner under `uid`', () => {
    expect(resolveTargetRef('list', 'list1'))
      .toEqual({ kind: 'doc', path: ['lists', 'list1'], ownerField: 'uid' });
  });
  it('comment → parses the packed reviews/{rid}/comments/{cid} path', () => {
    expect(resolveTargetRef('comment', 'reviews/r1/comments/c1'))
      .toEqual({ kind: 'doc', path: ['reviews', 'r1', 'comments', 'c1'], ownerField: 'uid' });
  });
  // BIN-1120. The decisive assertion is `ownerField`, not the path: a group
  // document keys its owner `ownerUid` and carries no `uid`. Had this returned
  // the same shape the other doc targets use, every group report would have been
  // WRITTEN with `targetOwnerUid: null` — accepted, not rejected, so nothing
  // would have failed, and the report would carry no owner for the admin to act
  // on. Derive the field name from the schema rather than this sentence:
  // `grep -n "ownerUid" firestore.rules`.
  it('group → groups/{id} doc path, owner under `ownerUid` and never `uid`', () => {
    const ref = resolveTargetRef('group', 'g1');
    expect(ref).toEqual({ kind: 'doc', path: ['groups', 'g1'], ownerField: 'ownerUid' });
    expect(ref).not.toMatchObject({ ownerField: 'uid' });
  });
  it('comment with a malformed path → invalid (unresolved, never a crash/wrong-doc read)', () => {
    expect(resolveTargetRef('comment', 'c1')).toEqual({ kind: 'invalid' });
    expect(resolveTargetRef('comment', 'reviews/r1/comments/c1/extra')).toEqual({ kind: 'invalid' });
    expect(resolveTargetRef('comment', 'reviews//comments/c1')).toEqual({ kind: 'invalid' }); // empty reviewId
    expect(resolveTargetRef('comment', 'users/u1')).toEqual({ kind: 'invalid' }); // wrong collection — can't redirect a read elsewhere
  });
});

describe('resolveDocOwner (BIN-1120 — the owner field differs per target)', () => {
  /** A snapshot that answers only the keys the seeded document actually has. */
  const snapOf = (data: Record<string, unknown> | null) => ({
    exists: data !== null,
    get: (field: string) => (data ? data[field] : undefined),
  });

  it('a group document resolves its owner from `ownerUid`', () => {
    const ref = resolveTargetRef('group', 'g1');
    expect(ref.kind).toBe('doc');
    if (ref.kind !== 'doc') return;
    // Seeded exactly as a group is stored: an `ownerUid`, and NO `uid` key.
    expect(resolveDocOwner(ref, snapOf({ ownerUid: 'owner1', memberUids: ['owner1', 'm2'] })))
      .toEqual({ targetOwnerUid: 'owner1', ownerResolved: true });
  });

  it('a review document still resolves its owner from `uid`', () => {
    const ref = resolveTargetRef('review', 'rev1');
    expect(ref.kind).toBe('doc');
    if (ref.kind !== 'doc') return;
    expect(resolveDocOwner(ref, snapOf({ uid: 'author1' })))
      .toEqual({ targetOwnerUid: 'author1', ownerResolved: true });
  });

  // The regression this whole pair exists for. Reading `uid` off a group gives
  // undefined, and an unresolved owner is WRITTEN rather than rejected — so the
  // report lands unattributed and no gate fires. Assert the wrong field yields
  // nothing, so a future edit that re-hardcodes `uid` fails here.
  it('reading the review field off a group document resolves nobody', () => {
    const group = snapOf({ ownerUid: 'owner1' });
    expect(resolveDocOwner({ kind: 'doc', path: ['groups', 'g1'], ownerField: 'uid' }, group))
      .toEqual({ targetOwnerUid: null, ownerResolved: false });
  });

  it('a missing document stays unresolved instead of rejecting', () => {
    const ref = resolveTargetRef('group', 'gone');
    if (ref.kind !== 'doc') return;
    expect(resolveDocOwner(ref, snapOf(null)))
      .toEqual({ targetOwnerUid: null, ownerResolved: false });
  });

  it('a non-string or empty owner stays unresolved', () => {
    const ref = resolveTargetRef('group', 'g1');
    if (ref.kind !== 'doc') return;
    expect(resolveDocOwner(ref, snapOf({ ownerUid: '' })).ownerResolved).toBe(false);
    expect(resolveDocOwner(ref, snapOf({ ownerUid: 42 })).ownerResolved).toBe(false);
  });
});

describe('isWithinCooldown', () => {
  const now = 1_000_000;
  it('true when the previous report is newer than the cooldown', () => {
    expect(isWithinCooldown(now - 1, now, 10_000)).toBe(true);
    expect(isWithinCooldown(now - 9_999, now, 10_000)).toBe(true);
  });
  it('false at exactly the cooldown boundary and beyond', () => {
    expect(isWithinCooldown(now - 10_000, now, 10_000)).toBe(false);
    expect(isWithinCooldown(now - 10_001, now, 10_000)).toBe(false);
  });
  it('false when there is no previous report', () => {
    expect(isWithinCooldown(null, now, 10_000)).toBe(false);
  });
});
