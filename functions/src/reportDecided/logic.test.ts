import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { decidesReport, reporterToNotify, REPORT_DECIDED_CARD, DECIDED_STATUSES } from './logic';

// The trigger body itself cannot be unit-tested without firebase-admin, so the
// decisions it makes ALONE are pinned by scanning its source — the idiom
// `groupHandover/logic.test.ts` already uses for its callable file. Both comment
// forms are stripped, so prose describing a rule can never satisfy the rule.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const ENTRY = readFileSync(join(HERE, 'index.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// The whole status vocabulary, read from the rule that admits a write. `it.each`
// over `DECIDED_STATUSES` alone registers FEWER tests when the list shrinks and
// fails none, and it says nothing at all when a fifth status is added to the
// admin UI — the reporter of a report in that status would simply never be told.
// Deriving the roster here makes both directions loud.
//   grep -n "status in \[" firestore.rules
const [REPORT_STATUSES, STATUS_LITERAL] = (() => {
  const rules = readFileSync(join(REPO, 'firestore.rules'), 'utf8');
  // Brace-matched to the reports block rather than sliced to end of file. The bound
  // is not airtight: one unbalanced brace in a rules comment inside the block moves
  // where it ends. The exact partition below is what catches a roster read from the
  // wrong block; this only narrows where it looks.
  const reportsBlock = (() => {
    const HEADER = 'match /reports/{reportId}';
    const start = rules.indexOf(HEADER);
    if (start < 0) return '';
    // Count from AFTER the header: the path segment `{reportId}` is a brace pair
    // of its own, and starting on it closes the block before it opens.
    let depth = 0;
    for (let i = rules.indexOf('{', start + HEADER.length); i < rules.length; i += 1) {
      if (rules[i] === '{') depth += 1;
      else if (rules[i] === '}' && (depth -= 1) === 0) return rules.slice(start, i);
    }
    return '';
  })();
  const literal = /request\.resource\.data\.status in \[([^\]]+)\]/.exec(reportsBlock)?.[1] ?? '';
  // `[^']+`, not a character class of what today's names happen to use. A narrower
  // class DROPS a status it cannot spell — `auto_actioned`, `needs-info` — and the
  // drop is invisible: the floor still clears, and the partition below still
  // balances because BOTH sides are missing it. The sibling watch-status vocabulary
  // in this repo already contains an underscore, so that is not a hypothetical.
  return [(literal.match(/'([^']+)'/g) ?? []).map((q) => q.slice(1, -1)), literal] as const;
})();

describe('decidesReport — only a transition INTO a decided status (BIN-1259)', () => {
  it.each(DECIDED_STATUSES)('open → %s is a decision', (status) => {
    expect(decidesReport({ status: 'open' }, { status })).toBe(true);
  });

  it('reviewed → actioned is a decision', () => {
    expect(decidesReport({ status: 'reviewed' }, { status: 'actioned' })).toBe(true);
  });

  // The regression this predicate exists for. `updateReportStatus` stamps
  // `updatedAt` on every save, so an admin who edits anything on an
  // already-decided report fires this trigger again. Without the before-side
  // test that would send a second card for the same decision.
  it('a later edit of an already-decided report is NOT a decision', () => {
    expect(decidesReport({ status: 'dismissed' }, { status: 'dismissed' })).toBe(false);
    expect(decidesReport({ status: 'actioned' }, { status: 'actioned' })).toBe(false);
  });

  it('moving between the two decided statuses is not a new decision', () => {
    expect(decidesReport({ status: 'actioned' }, { status: 'dismissed' })).toBe(false);
  });

  it('open → reviewed is not a decision — the report is still in progress', () => {
    expect(decidesReport({ status: 'open' }, { status: 'reviewed' })).toBe(false);
  });

  // Re-opening and deciding again IS a second decision: the status left the
  // decided set in between. The trigger still writes one card, because the
  // document id is derived from the report — see the header in index.ts.
  it('a re-opened report that is decided again counts as a decision', () => {
    expect(decidesReport({ status: 'open' }, { status: 'actioned' })).toBe(true);
  });

  it('a missing or malformed status never decides', () => {
    expect(decidesReport({ status: 'open' }, undefined)).toBe(false);
    expect(decidesReport({ status: 'open' }, {})).toBe(false);
    expect(decidesReport({ status: 'open' }, { status: 42 })).toBe(false);
    expect(decidesReport({ status: 'open' }, { status: 'Actioned' })).toBe(false);
  });

  it('a first write with no before still decides', () => {
    expect(decidesReport(undefined, { status: 'actioned' })).toBe(true);
  });
});

describe('the wording the reporter gets', () => {
  // Malin's decision 2026-09-20, on #12 Trust & Safety's reasoning: one wording
  // for both outcomes. A reporter who can read the outcome can file repeatedly
  // to learn whether an admin sides with them. Assert the absence directly —
  // this is the whole point of the card, not a style preference.
  it('names neither the outcome nor the target', () => {
    const text = `${REPORT_DECIDED_CARD.title} ${REPORT_DECIDED_CARD.body}`.toLowerCase();
    for (const leak of ['åtgärd', 'avfärd', 'borttagen', 'raderad', 'grupp', 'användare']) {
      expect(text).not.toContain(leak);
    }
  });

  it('is the same card whichever decided status was reached', () => {
    // There is one card, so there is nothing to key on. Pinned so a later edit
    // that reintroduces per-outcome wording has to change this test on purpose.
    expect(Object.keys(REPORT_DECIDED_CARD).sort()).toEqual(['body', 'title']);
  });
});

describe('reporterToNotify', () => {
  it('returns the reporter uid', () => {
    expect(reporterToNotify({ reporterUid: 'u1' })).toBe('u1');
  });

  it('returns null rather than throwing when the field is missing or unusable', () => {
    expect(reporterToNotify(undefined)).toBeNull();
    expect(reporterToNotify({})).toBeNull();
    expect(reporterToNotify({ reporterUid: '' })).toBeNull();
    expect(reporterToNotify({ reporterUid: 42 })).toBeNull();
  });
});

describe('notifyReportDecided — what the trigger file decides on its own (BIN-1259)', () => {
  it('declares exactly one trigger', () => {
    expect([...ENTRY.matchAll(/export const \w+ = onDocument\w+\(/g)]).toHaveLength(1);
  });

  // Idempotence is the document id. A generated id, or one keyed on anything that
  // varies between deliveries, stacks a card per retry.
  it('writes the card at the report-keyed id', () => {
    expect(ENTRY).toMatch(/\.doc\(`report_\$\{event\.params\.reportId\}`\)/);
  });

  // `create`, never `set`: a `set` rewrites `read: false` and a fresh `createdAt`
  // on redelivery, lifting a card the reporter already opened back to the top.
  it('writes with create and never with set', () => {
    expect([...ENTRY.matchAll(/\.create\(/g)]).toHaveLength(1);
    expect(ENTRY).not.toMatch(/\.set\(/);
  });

  // ALREADY_EXISTS is the ordinary redelivery; anything else must surface.
  it('swallows only ALREADY_EXISTS and rethrows the rest', () => {
    expect(ENTRY).toMatch(/code\s*!==\s*6\)\s*throw err/);
  });

  // The reporter never sees the admin's own words.
  it('reads no admin-written reason field off the report', () => {
    expect(ENTRY).not.toMatch(/\b(note|reason|adminNote)\b/);
  });
});

describe('DECIDED_STATUSES against the whole status vocabulary (BIN-1259)', () => {
  it('reads a roster out of firestore.rules', () => {
    expect(REPORT_STATUSES.length).toBeGreaterThanOrEqual(4);
  });

  // The parse is COMPLETE, not merely non-empty: every quoted token in the literal
  // reached the roster. This is what catches a future narrowing of the class above,
  // which the partition alone cannot see.
  it('drops no quoted token from the literal', () => {
    expect(REPORT_STATUSES).toHaveLength((STATUS_LITERAL.match(/'/g) ?? []).length / 2);
  });

  // The statuses that deliberately do NOT notify the reporter. Written out here
  // rather than derived, because that IS the decision: a status is in this list
  // only when someone chose to leave its reporter untold.
  const NOT_DECIDED = ['open', 'reviewed'];

  // The partition must be exact. A fifth status added to the rules belongs to
  // neither list until someone puts it in one, and this reddens until they do —
  // which is the direction that silently costs a reporter their notification.
  // An asymmetric membership check would pass on a status nobody classified.
  it('every status the rules admit is classified, and nothing else is', () => {
    expect([...DECIDED_STATUSES, ...NOT_DECIDED].sort()).toEqual([...REPORT_STATUSES].sort());
  });

  it.each(REPORT_STATUSES)('%s notifies the reporter only if it is decided', (status) => {
    expect(decidesReport({ status: 'open' }, { status }))
      .toBe((DECIDED_STATUSES as readonly string[]).includes(status));
  });

  // The two literals the sibling fixtures hardcode. Dropping either from
  // DECIDED_STATUSES stops being a quietly shorter it.each and becomes a red.
  it('actioned and dismissed are both decided', () => {
    expect(decidesReport({ status: 'open' }, { status: 'actioned' })).toBe(true);
    expect(decidesReport({ status: 'open' }, { status: 'dismissed' })).toBe(true);
  });

  it('open and reviewed are not', () => {
    expect(decidesReport({ status: 'open' }, { status: 'reviewed' })).toBe(false);
    expect(decidesReport({ status: 'reviewed' }, { status: 'open' })).toBe(false);
  });
});
