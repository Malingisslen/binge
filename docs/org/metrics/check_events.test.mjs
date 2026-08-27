// check_events.test.mjs — BIN-918.
//
// The four REAL_FALSE_ROWS fixtures are READ OUT of events.jsonl at test time rather than
// copied here, so "these are the real rows" is true by construction instead of by assertion
// (see the comment on the constant — an earlier hand-copied version made exactly the kind
// of unchecked claim this ticket exists to stop). They are the rows the check was filed
// about: written 13:53:30Z in the sprint's SELECTION step, asserting "BUILT and committed"
// for commits authored 39 and 92 minutes later — and, for BIN-909, for work never built.
//
// The two TIME fixtures exist because of a gap #21 Technical Writer found in the plan: none
// of the real rows reaches the freshness comparison (they fail earlier, on the missing
// field), and the honest worktree row passes on its negation without reaching it either. So
// the inequality could have shipped INVERTED with every other test green. Both directions
// are pinned here on purpose.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import {
  EVENTS_PATH, SHIPPED_OUTCOME, RULE_EFFECTIVE_FROM,
  claimsReachedMain, ticketOf, findViolations, parseEvents, gitCommitDate, historyIsAvailable,
} from './check_events.mjs';

const REPO = dirname(EVENTS_PATH);
const INCIDENT_TS = '2026-08-16T13:53:30.297Z';

/**
 * READ FROM THE LIVE FILE, not copied into this file.
 *
 * The first version of this test hand-copied the four rows and its header called them "the
 * actual bytes". They were not: the BIN-909 fixture had been trimmed to one panel role when
 * the real row lists five, and all four dropped `must_haves`/`conflicts`/`escalations`/
 * `adrs`/`rubber_stamp`. Inert to this checker — it reads none of those fields — but a
 * literal falsehood in the header of a file whose entire subject is unchecked claims. The
 * test review caught it (2026-08-17).
 *
 * Reading them makes the claim true by construction and cannot drift. It also means these
 * tests assert the rows are still present and still shaped as described; if a future edit
 * removes or rewrites them, the count assertion below goes red rather than the suite
 * quietly testing a fiction.
 */
const REAL_FALSE_ROWS = parseEvents(readFileSync(EVENTS_PATH, 'utf8'))
  .filter(row => row.type === 'review' && row.ts === INCIDENT_TS);

// REAL, and the reason the check is not keyed on the word "built": this row is honest.
const HONEST_WORKTREE_ROW = {
  ts: '2026-08-15T20:00:00.000Z', type: 'review', outcome: 'declined-unattended', ran: false,
  plan: 'BIN-877 — built in a worktree; NOT committed, NOT pushed and NOT parked In Review. CORRECTS the row above.',
};

const HONEST_PULLED_ROW = {
  ts: '2026-08-15T19:00:00.000Z', type: 'review', outcome: 'declined-unattended', ran: false,
  plan: 'BIN-816 — pulled out before the build; an unattended sprint cannot convene this review',
};

const never = () => null;
const at = (iso) => () => iso;

describe('the fixtures are the live rows', () => {
  it('finds exactly the four rows the incident produced, still in the log', () => {
    // Guards the read above: a filter that silently matched nothing would make most of
    // this file vacuously green, and events.jsonl is append-only so they must stay.
    expect(REAL_FALSE_ROWS).toHaveLength(4);
    expect(REAL_FALSE_ROWS.map(r => ticketOf(r)).sort())
      .toEqual(['BIN-880', 'BIN-906', 'BIN-908', 'BIN-909']);
  });

  it('BIN-909\'s row names all five roles that made it unreviewable unattended', () => {
    // The detail the correction row and the README both lean on: tier `top` with five
    // owning roles is WHY an unattended sprint could not convene the panel. A trimmed
    // fixture hid this in the first version of the file.
    const row = REAL_FALSE_ROWS.find(r => ticketOf(r) === 'BIN-909');
    expect(row.panel).toHaveLength(5);
    expect(row.panel).toContain('#5 Legal / GDPR Counsel');
    expect(row.panel).toContain('#6 Data Protection Officer');
  });
});

describe('claimsReachedMain — what counts as asserting the code reached main', () => {
  it('the four real rows all claim it', () => {
    for (const row of REAL_FALSE_ROWS) {
      expect(claimsReachedMain(row.plan), row.plan.slice(0, 12)).toBe(true);
    }
  });

  it('"built in a worktree; NOT committed, NOT pushed" does NOT claim it', () => {
    // The whole reason the patterns exclude "built". Seven rows in the live log say this,
    // and every one of them is telling the truth.
    expect(claimsReachedMain(HONEST_WORKTREE_ROW.plan)).toBe(false);
  });

  it('"pulled out before the build" does not claim it', () => {
    expect(claimsReachedMain(HONEST_PULLED_ROW.plan)).toBe(false);
  });

  it('a negator governs only its own clause, not the whole row', () => {
    // "nothing was committed. Then committed anyway" must still be caught: the second
    // claim is un-negated and the sentence boundary stops the negator reaching it.
    expect(claimsReachedMain('nothing was committed')).toBe(false);
    expect(claimsReachedMain('nothing was built here. It was committed to main')).toBe(true);
  });
});

describe('ticketOf — anchored, because the rejected draft was not', () => {
  it('reads a stamped ticket field first', () => {
    expect(ticketOf({ ticket: 'BIN-123', plan: 'BIN-999 — prose' })).toBe('BIN-123');
  });

  it('backfills from prose ONLY when the prose starts with the id', () => {
    expect(ticketOf(REAL_FALSE_ROWS[0])).toBe('BIN-908');
  });

  it('refuses an id that is not at the start — the exact failure that sank the first draft', () => {
    // The rejected version took any BIN-id anywhere, so a leading prose token (ISO-8601,
    // UTF-8, ADR-0021) was parsed as the ticket. Anchoring makes that impossible; the
    // price is a null, which the checker reports loudly rather than swallowing.
    expect(ticketOf({ plan: 'ISO-8601 timestamps — BIN-908 committed to main' })).toBeNull();
    expect(ticketOf({ plan: 'ADR-0021 — BIN-908 committed' })).toBeNull();
  });
});

describe('findViolations', () => {
  it('fails all four real rows — including BIN-909, which was never built', () => {
    const { violations } = findViolations(REAL_FALSE_ROWS, never);
    expect(violations).toHaveLength(4);
    expect(violations.map(v => v.ticket).sort())
      .toEqual(['BIN-880', 'BIN-906', 'BIN-908', 'BIN-909']);
    for (const v of violations) expect(v.reason).toContain('names no `commit_sha`');
  });

  it('passes the honest rows without demanding evidence they never claimed', () => {
    // Needs one claiming row present, or the floor fires — which is itself the point of
    // the floor, so it is asserted separately below rather than worked around silently.
    const withOneClaim = [
      HONEST_WORKTREE_ROW,
      HONEST_PULLED_ROW,
      { ts: '2026-08-16T18:00:00.000Z', type: 'review', ticket: 'BIN-895', outcome: SHIPPED_OUTCOME, commit_sha: 'b10ccf3' },
    ];
    const { violations } = findViolations(withOneClaim, at('2026-08-16T17:00:00.000Z'));
    expect(violations).toEqual([]);
  });

  it('a correction keyed on {ts, ticket} retires the row it names — and only that one', () => {
    // All four share a byte-identical `ts`, which is why `ts` alone cannot be the key.
    const rows = [
      ...REAL_FALSE_ROWS,
      { ts: '2026-08-17T09:00:00.000Z', type: 'correction', corrects: { ts: '2026-08-16T13:53:30.297Z', ticket: 'BIN-909' } },
    ];
    const { violations } = findViolations(rows, never);
    expect(violations.map(v => v.ticket).sort()).toEqual(['BIN-880', 'BIN-906', 'BIN-908']);
  });

  it('counts a retired claim as RETIRED, never as evidenced', () => {
    // The fourth state. All four live rows pass only because corrections retire them, and
    // none carries a sha — so a run that printed "4 claims checked" as clean would be this
    // checker making the same shape of overclaim it was built to catch.
    const rows = [
      ...REAL_FALSE_ROWS,
      ...['BIN-880', 'BIN-906', 'BIN-908', 'BIN-909'].map(ticket => ({
        ts: '2026-08-17T09:00:00.000Z', type: 'correction', corrects: { ts: INCIDENT_TS, ticket },
      })),
    ];
    const result = findViolations(rows, never);
    expect(result.violations).toEqual([]);
    expect(result.claimsChecked).toBe(4);
    expect(result.correctedAway).toBe(4);
    // Assert the FIELD, not `checked − retired − unverifiable`. That subtraction is the
    // shape the production code used to have, and it was wrong — it never subtracted the
    // violations, so a violating claim was reported as evidenced. A test that re-derives
    // it cannot fail on it: reverting the return to the old shape left this file 31/31
    // green, measured (integration review, fifth pass).
    expect(result.evidenced).toBe(0);
  });

  it('a VIOLATING claim is never counted as evidenced — the case both shapes disagree on', () => {
    // This is the only fixture that can tell the two implementations apart, and writing
    // the first two without it was the same mistake one level up. The subtraction
    // `checked − retired − unverifiable` and the direct count agree whenever there are no
    // violations — which is every other case in this file — so both of the assertions
    // added alongside it stayed green against the buggy shape when measured.
    //
    // Here one row is genuinely evidenced and one is not. Correct answer: 1. The
    // subtraction says 2, because it never subtracts the violation, which is exactly what
    // made the CLI print "1 evidenced" on the line above the violation it was reporting.
    const rows = [
      {
        ts: '2026-08-16T16:00:00.000Z', type: 'review', ticket: 'BIN-908',
        outcome: SHIPPED_OUTCOME, commit_sha: '049f21b',
      },
      {
        ts: '2026-08-16T16:00:00.000Z', type: 'review', ticket: 'BIN-999',
        outcome: SHIPPED_OUTCOME, plan: 'BIN-999 — committed',
      },
    ];
    const result = findViolations(rows, at('2026-08-16T14:32:45.000Z'));
    expect(result.claimsChecked).toBe(2);
    expect(result.violations).toHaveLength(1);
    expect(result.evidenced).toBe(1);
  });

  it('a correction keyed on ts ALONE retires nothing — the four would collapse into one', () => {
    const rows = [
      ...REAL_FALSE_ROWS,
      { ts: '2026-08-17T09:00:00.000Z', type: 'correction', corrects: { ts: '2026-08-16T13:53:30.297Z' } },
    ];
    expect(findViolations(rows, never).violations).toHaveLength(4);
  });

  it('reports a claiming row that can never be corrected, loudly', () => {
    const rows = [{ ts: '2026-08-16T13:00:00.000Z', type: 'review', outcome: SHIPPED_OUTCOME, plan: 'shipped it' }];
    const { violations } = findViolations(rows, never);
    expect(violations).toHaveLength(1);
    expect(violations[0].ticket).toBeNull();
    expect(violations[0].reason).toContain('no correction can ever be keyed to it');
  });

  it('rejects a sha that does not exist in the repo', () => {
    const rows = [{ ts: '2026-08-16T13:00:00.000Z', type: 'review', ticket: 'BIN-1', outcome: SHIPPED_OUTCOME, commit_sha: 'deadbee' }];
    expect(findViolations(rows, never).violations[0].reason).toContain('does not exist');
  });

  it('rejects a value that is not a sha at all', () => {
    const rows = [{ ts: '2026-08-16T13:00:00.000Z', type: 'review', ticket: 'BIN-1', outcome: SHIPPED_OUTCOME, commit_sha: 'HEAD~1' }];
    expect(findViolations(rows, never).violations[0].reason).toContain('is not a sha');
  });

  // ---- the freshness comparison, both directions ----
  //
  // Neither of the four real rows reaches this code (they fail on the missing field), so
  // without these two the inequality could ship inverted and stay green forever. That is
  // exactly the shape of the bug this whole ticket is about: a check that looks satisfied
  // and protects nothing.

  it('FAILS a row naming a commit that is NEWER than the row — the BIN-908 shape', () => {
    // Row written 13:53:30Z; 049f21b is authored 14:32:45Z. The row could not have
    // witnessed it. (An earlier version of this comment said 15:25 here — that is
    // 851696d's time, and writing it on 049f21b's fixture was the SAME conflation the
    // integration review had already caught once in the correction rows. It survived
    // because the stubbed resolver makes the number inert. Integration review, 2026-08-17.)
    const rows = [{
      ts: '2026-08-16T13:53:30.297Z', type: 'review', ticket: 'BIN-908',
      outcome: SHIPPED_OUTCOME, commit_sha: '049f21b',
    }];
    const { violations } = findViolations(rows, at('2026-08-16T14:32:45.000Z'));
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain('NEWER than the row');
  });

  it('PASSES a row naming a commit that already existed when the row was written', () => {
    const rows = [{
      ts: '2026-08-16T16:00:00.000Z', type: 'review', ticket: 'BIN-908',
      outcome: SHIPPED_OUTCOME, commit_sha: '049f21b',
    }];
    const result = findViolations(rows, at('2026-08-16T15:25:00.000Z'));
    expect(result.violations).toEqual([]);
    // The other direction of the same guard: a row that survives every check is the ONLY
    // thing that may be counted as evidenced.
    expect(result.evidenced).toBe(1);
  });

  it('PASSES a commit stamped at exactly the row time — the boundary is inclusive', () => {
    const rows = [{
      ts: '2026-08-16T15:25:00.000Z', type: 'review', ticket: 'BIN-908',
      outcome: SHIPPED_OUTCOME, commit_sha: '049f21b',
    }];
    expect(findViolations(rows, at('2026-08-16T15:25:00.000Z')).violations).toEqual([]);
  });

  it('a file with no reaching-main claims at all FAILS the floor', () => {
    // Zero examined must never read as clean. A shape change or a broken read would
    // otherwise turn this check into a permanent green light.
    const { violations } = findViolations([HONEST_PULLED_ROW], never);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain('ZERO');
  });
});

describe('the two false positives the first run produced on live data', () => {
  // Both were defects in the CHECK, not in the log, and both were found by pointing the
  // check at the real file rather than only at the fixtures I had written for it.

  it('"22 merged binding conditions" is not a claim that code reached main', () => {
    // BIN-813's real row. `merged` was in the pattern list for exactly one run; what is
    // merged here is CONDITIONS. A pattern observed to misfire on live data is removed,
    // not kept with a caveat.
    expect(claimsReachedMain(
      'BIN-813 — FULL PANEL. Router re-run corrected the sprint\'s recorded tier. 22 merged binding conditions',
    )).toBe(false);
  });

  it('reads a single-entry `tickets` ARRAY, which some early rows use instead of `ticket`', () => {
    expect(ticketOf({ tickets: ['BIN-309'], note: 'shipped blockeringar fix only' })).toBe('BIN-309');
    // Two entries is not a key — it falls through rather than silently picking the first.
    expect(ticketOf({ tickets: ['BIN-1', 'BIN-2'], note: 'shipped it' })).toBeNull();
  });
});

describe('the effective date — a bounded, visible exemption', () => {
  const beforeRule = {
    ts: '2026-06-29T21:39:39.607Z', type: 'review', tickets: ['BIN-309'],
    outcome: 'build-modified', note: 'shipped blockeringar fix only, rename deferred',
  };
  const inScope = {
    ts: '2026-08-16T13:53:30.297Z', type: 'review', ticket: 'BIN-908',
    outcome: SHIPPED_OUTCOME, plan: 'BIN-908 — BUILT and committed',
  };

  it('grandfathers a truthful pre-rule claim rather than retro-demanding a sha', () => {
    const { violations } = findViolations([beforeRule, inScope], never);
    // The old row is exempt; the in-scope one is not.
    expect(violations.map(v => v.ticket)).toEqual(['BIN-908']);
  });

  it('counts the exemption out loud instead of hiding it', () => {
    // No silent caps: a run that skipped rows must say how many.
    const result = findViolations([beforeRule, inScope], never);
    expect(result.grandfathered).toBe(1);
    expect(result.claimsChecked).toBe(1);
  });

  it('grandfathered rows do NOT satisfy the floor — an all-exempt file still fails', () => {
    // Otherwise moving the effective date forward would quietly switch the check off.
    const { violations } = findViolations([beforeRule], never);
    expect(violations.some(v => String(v.reason).includes('ZERO'))).toBe(true);
  });

  it('a claim stamped at EXACTLY the effective moment is in scope, not exempt', () => {
    // The boundary itself. `<` vs `<=` on the grandfather test decides whether a row
    // landing on the constant is judged or waved through, and nothing else pinned it.
    const onTheBoundary = {
      ts: RULE_EFFECTIVE_FROM, type: 'review', ticket: 'BIN-1',
      outcome: SHIPPED_OUTCOME, plan: 'BIN-1 — committed',
    };
    const result = findViolations([onTheBoundary], never);
    expect(result.grandfathered).toBe(0);
    expect(result.claimsChecked).toBe(1);
    expect(result.violations).toHaveLength(1);
  });

  it('the effective date is the incident it was filed about, not an arbitrary cutoff', () => {
    // Pinned so a future edit that slides it forward has to argue with a test. The four
    // false rows are stamped 13:53 that day and must stay inside the rule.
    expect(RULE_EFFECTIVE_FROM).toBe('2026-08-16T00:00:00.000Z');
    expect(Date.parse('2026-08-16T13:53:30.297Z')).toBeGreaterThan(Date.parse(RULE_EFFECTIVE_FROM));
  });
});

describe('the live events.jsonl', () => {
  it('parses, and every reaching-main claim in it is evidenced or corrected', () => {
    // The real file through the real resolver — `gitCommitDate`, NOT the `never` stub the
    // pure fixtures use. That distinction is the whole point of this assertion.
    //
    // It was `never` for one round, and the integration review measured what that would
    // have cost: the stub denies every sha, so the FIRST row written the way README's tense
    // rule instructs — a real `commit_sha` that predates its row — would have turned
    // `npm test` red with "does not exist in this repo", while the CLI reported clean. Two
    // answers for one file, and the suite is what gates deploy. A check that punishes the
    // first person to obey it gets switched off, which is how this whole class of thing
    // dies. It passed only because no live row carries the field yet.
    //
    // KNOW WHAT THIS ASSERTION COSTS: it reads the LIVE log, and `npm test` is a blocking
    // step in deploy.yml. The next `declined-unattended-shipped` row the
    // sprint engine writes turns this red and holds the production deploy of unrelated
    // code. Deliberate — such a row means unreviewed code reached main — but the remedy is
    // append a `correction` keyed on {ts, ticket}, or add the missing `commit_sha`. Do not
    // weaken the rule to clear it; move this one assertion to a CLI-only check instead.
    //
    // And know where it shows up FIRST, which is not CI: the engine writes these rows
    // unstaged ("Do not commit and do not stage"), and shared-plugin.json's
    // `delivery.cleanTreeIgnore` waves events.jsonl through, so the first symptom is a red
    // LOCAL run on an unstaged row — which the sprint that just wrote it will read as its
    // own batch failing. Check `git status` for events.jsonl before suspecting the code
    // under test.
    const rows = parseEvents(readFileSync(EVENTS_PATH, 'utf8'));
    expect(rows.some(r => r.type === 'unparseable')).toBe(false);
    expect(findViolations(rows, gitCommitDate, { historyAvailable: historyIsAvailable() })
      .violations).toEqual([]);
  });

  it('accepts a row that obeys the contract, against real git', () => {
    // The complement, and the regression guard for the paragraph above: an honest row
    // naming a real commit that predates it must PASS through the real resolver.
    //
    // Resolved from HEAD, not from a hard-coded historical sha. The first version named
    // 851696d — six commits back — and the integration review measured what that costs:
    // A shallow checkout sits at the default depth 1, where every historical
    // sha is "unknown revision", so this would have gone red on any shallow checkout while staying
    // green on the push path nobody watches. HEAD exists at any depth. The row's `ts` is
    // derived from the commit's own date so the freshness rule is genuinely satisfied
    // rather than dodged with a distant constant.
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
    const headDate = gitCommitDate(head);
    expect(headDate, 'HEAD must resolve at any clone depth').toBeTruthy();

    const honest = [{
      ts: new Date(Date.parse(headDate) + 60_000).toISOString(), type: 'review',
      ticket: 'BIN-880', outcome: SHIPPED_OUTCOME, commit_sha: head,
    }];
    expect(findViolations(honest, gitCommitDate).violations).toEqual([]);
  });

  it('a SHALLOW checkout reports "could not verify", never "does not exist"', () => {
    // The three states must stay distinguishable. In a depth-1 clone the sha lookup cannot
    // run, and answering it as absence would fail every honest row in CI — the exact shape
    // of "the check punishes the first person to obey it", moved from a stubbed resolver
    // into the clone depth.
    const rows = [{
      ts: '2026-08-17T09:00:00.000Z', type: 'review', ticket: 'BIN-880',
      outcome: SHIPPED_OUTCOME, commit_sha: '851696d',
    }];
    const shallow = findViolations(rows, never, { historyAvailable: false });
    expect(shallow.violations).toEqual([]);
    expect(shallow.unverified).toBe(1);

    // …and the pure half still bites in a shallow clone: no sha is still no claim.
    const noSha = [{
      ts: '2026-08-17T09:00:00.000Z', type: 'review', ticket: 'BIN-880',
      outcome: SHIPPED_OUTCOME,
    }];
    const stillFails = findViolations(noSha, never, { historyAvailable: false });
    expect(stillFails.violations).toHaveLength(1);
    expect(stillFails.unverified).toBe(0);
  });
});
