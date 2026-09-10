import { describe, it, expect } from 'vitest';

import {
  FIELD_OWNED_CATEGORIES,
  FIELD_OWNED_MAX_DOCS_PER_UID,
  NO_FINDINGS,
  findingsSize,
  handoverEstimate,
  withinDocumentBudget,
  type CategoryFindings,
} from './fieldOwned';

const found = (deletes: number, strips = 0): CategoryFindings => ({
  deletePaths: Array.from({ length: deletes }, (_, i) => `reviews/r${i}`),
  arrayStrips: Array.from({ length: strips }, (_, i) => ({ path: `lists/l${i}`, field: 'editors' })),
});

describe('FIELD_OWNED_CATEGORIES', () => {
  // The run walks this array. A category dropped from it is silently never
  // swept, and every per-category test would still pass for the ones that
  // remain — so the list itself needs pinning, not just its members.
  it('names every category the field-owned sweep is responsible for', () => {
    expect([...FIELD_OWNED_CATEGORIES]).toEqual([
      'reviews', 'foreignReviewUgc', 'reactions', 'lists', 'sessions',
      'groupInvitesSent', 'groups',
    ]);
  });

  // The order is a decision, not incidental, so pin the two places it matters
  // rather than only the membership: `groups` runs the handover and must be
  // last, and the sent invites must be erased before it, so both doors agree
  // that an invitation is the sender's to erase however ownership moved.
  it('erases sent invites before it touches groups, and groups last', () => {
    const order = [...FIELD_OWNED_CATEGORIES];
    expect(order.indexOf('groupInvitesSent')).toBeLessThan(order.indexOf('groups'));
    expect(order[order.length - 1]).toBe('groups');
  });

  it('has no duplicates', () => {
    expect(new Set(FIELD_OWNED_CATEGORIES).size).toBe(FIELD_OWNED_CATEGORIES.length);
  });
});

describe('findingsSize', () => {
  it('counts a document once whether it is deleted or stripped', () => {
    expect(findingsSize(found(3, 2))).toBe(5);
    expect(findingsSize(NO_FINDINGS)).toBe(0);
  });
});

describe('handoverEstimate', () => {
  // Both the Admin port and the emulator harness call this, so the budget the
  // emulator test proves is the budget production computes.
  it('counts the group document plus the leaver’s own rows under it', () => {
    expect(handoverEstimate([
      'groups/g/members/gone',
      'groups/g/members/keeper',
      'groups/g/watchlist/movie_1',
      'groups/g/watchlist/movie_1/progress/gone',
    ], 'gone')).toBe(3);
  });

  // A ghost owner — in `memberUids` with no member row — costs the group
  // document alone. The floor, and the case the estimate is smallest on.
  it('counts the group document even when the leaver owns no rows', () => {
    expect(handoverEstimate(['groups/g/members/keeper'], 'gone')).toBe(1);
    expect(handoverEstimate([], 'gone')).toBe(1);
  });

  // Two ways a neighbouring uid can look like the leaver, and they catch
  // different mutations. `notgone` catches dropping the `/` from the needle (a
  // bare `endsWith('gone')` would match it); `gone-other` catches `endsWith`
  // becoming `includes` (the path contains `/gone` but does not end with it).
  it('does not count a row belonging to a different uid', () => {
    expect(handoverEstimate(['groups/g/members/notgone'], 'gone')).toBe(1);
    expect(handoverEstimate(['groups/g/members/gone-other'], 'gone')).toBe(1);
  });
});

describe('withinDocumentBudget', () => {
  // The account-level ceiling in orphans.ts answers "did we pick the wrong
  // people". This answers what that ceiling cannot see: the blast radius of a
  // CORRECT pick is unbounded in documents.
  it('allows a run under the budget and reports what it costs', () => {
    expect(withinDocumentBudget([found(3), found(2, 1)])).toEqual({ allowed: true, documents: 6 });
  });

  it('sums across categories rather than judging each alone', () => {
    // Two categories each just under the budget are over it together. A
    // per-category check would let both through.
    const half = found(FIELD_OWNED_MAX_DOCS_PER_UID - 1);
    expect(withinDocumentBudget([half, half]).allowed).toBe(false);
  });

  // The boundary in both directions, with literal numbers: `<` instead of `<=`
  // would refuse a run that exactly fills the budget, and `<` on the other side
  // would admit one document too many.
  it('admits exactly the budget and refuses one more', () => {
    expect(withinDocumentBudget([found(4)], 4)).toEqual({ allowed: true, documents: 4 });
    expect(withinDocumentBudget([found(5)], 4)).toEqual({ allowed: false, documents: 5 });
  });

  it('allows a uid that owns nothing', () => {
    expect(withinDocumentBudget([NO_FINDINGS, NO_FINDINGS])).toEqual({ allowed: true, documents: 0 });
  });

  // Array strips count toward the budget. They are writes to documents somebody
  // ELSE owns — a co-edited list — so if anything they are the ones a runaway
  // sweep should be stopped from making.
  it('counts array strips, not only deletions', () => {
    expect(withinDocumentBudget([found(0, 5)], 4).allowed).toBe(false);
  });
});
