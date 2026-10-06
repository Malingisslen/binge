// check_review_coverage.test.mjs — BIN-917.
//
// The module under test asks "is there a review row at all?", which is the inverse of its
// sibling's "does this row carry its evidence?". Two properties make that easy to get wrong
// and are pinned hardest here:
//
//   1. THE DENOMINATOR. A rule that demands a row from every commit goes permanently red —
//      much of this repo's history is docs/chore/style automation — and a rule that demands
//      one from too few is vacuous. Every branch of `owesReviewRow` is driven
//      directly, including the `feat!:` breaking-change spelling and the bare `fix:` with no
//      scope, because a regex that silently stopped matching one of them would shrink the
//      denominator without failing anything.
//
//   2. THE FLOOR. `findCoverageGaps` fires its hard floor on an empty WALK, not on an empty
//      eligible set — a deliberate deviation from the blind critique's literal wording, and
//      the reason is in the module's own comment. Both halves are pinned: a broken read
//      MUST be a violation, and a legitimately empty eligible set MUST NOT be, or this file
//      would have shipped red on the day it landed.
//
// The live-repo case at the bottom reads the real log and the real git history, the way its
// sibling does. It is what makes the check true of this repo rather than only of fixtures.

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  COVERAGE_EFFECTIVE_FROM,
  owesReviewRow,
  ticketsInSubject,
  ticketsWithAReviewRow,
  parseGitLog,
  readGitLog,
  findCoverageGaps,
  gradeSubject,
  mainMessage,
  stagedEventsLog,
  REPO_ROOT,
  DEFAULT_EVENTS_REL,
  dependabotPrefixesFrom,
  readDependabotPrefixes,
  readBotBumpShas,
  exemptionInputs,
  REVIEWER_INSTRUCTIONS,
  INSTRUCTIONS_EFFECTIVE_FROM,
  changesReviewerInstructions,
  filesOfCommit,
  stagedFiles,
  TICKET_BY_SHA,
  REVIEW_SCOPE_EFFECTIVE_FROM,
  TYPE_FREE,
  isFeature,
  reviewOwedFor,
  owesReview,
  reviewGatesAtCommits,
  stagedAddedFiles,
  stagedReviewGates,
  GATES_CONFIG_REL,
} from './check_review_coverage.mjs';
import { EVENTS_PATH, parseEvents, historyIsAvailable } from './check_events.mjs';
import { HIGH_STAKES, parseReviewGates, readReviewGates } from '../route.mjs';

// The METRICS directory, not the repo root — named for what it is. Its only use is a `git
// show <rev>:<path>` rev-spec, which ignores the cwd; calling it REPO taught the wrong fact
// and is one letter from the confusion that produced the fallback ENOENT (integration review).
const METRICS_DIR = dirname(EVENTS_PATH);
const EPOCH = COVERAGE_EFFECTIVE_FROM;
const AFTER = '2026-08-19T12:00:00.000Z';
const BEFORE = '2026-08-01T12:00:00.000Z';

const commit = (sha, subject, date = AFTER) => ({ sha, date, subject });

describe('owesReviewRow — the denominator, driven branch by branch', () => {
  it('feat and fix owe a row, with or without a scope', () => {
    expect(owesReviewRow('feat(watchlist): add a thing (BIN-1)')).toBe(true);
    expect(owesReviewRow('fix: repair a thing (BIN-2)')).toBe(true);
    expect(owesReviewRow('fix(org): repair a thing (BIN-3)')).toBe(true);
  });

  it('the breaking-change spelling still owes one', () => {
    // `feat!:` and `feat(scope)!:` are conventional-commit's breaking marker. A regex that
    // required `:` immediately after the scope would exempt exactly the riskiest commits.
    expect(owesReviewRow('feat!: drop the old field (BIN-4)')).toBe(true);
    expect(owesReviewRow('feat(data)!: drop the old field (BIN-5)')).toBe(true);
  });

  it('so do the other code-changing types — refactor, perf, test, build, ci', () => {
    // `test` is the load-bearing one, and it is why the denominator is not just feat|fix:
    // `049f21b` is `test(radering): … (BIN-908)` and is HALF THE INCIDENT this file exists
    // for. The first draft excluded it and would have sailed past the ticket's own headline.
    for (const subject of [
      'test(radering): pinna recent-login-felet som saknar hand-over-taggen (BIN-908)',
      'refactor(push): move a port (BIN-8)',
      'perf(tmdb): cache the lookup (BIN-9)',
      'build(deps): bump next (BIN-10)',
      'ci: find script self-tests by pattern (BIN-11)',
    ]) {
      expect(owesReviewRow(subject), subject).toBe(true);
    }
  });

  it('docs, chore and style do not — the automation classes', () => {
    // Nightly comment sweeps, janitor runs, lessons-digest folds. Demanding rows from
    // these is how the check gets switched off.
    for (const subject of [
      'docs(map): re-trace a flow (BIN-6)',
      'chore(janitor): weekly maintenance sweep',
      'style: reformat',
    ]) {
      expect(owesReviewRow(subject), subject).toBe(false);
    }
  });

  it('an unprefixed commit and a revert are OUT OF SCOPE, not silently passed', () => {
    // A stated limit rather than a hidden one: neither matches, so neither is judged. How
    // many such commits exist depends on which grammar you count with — the module header
    // carries the deriving command rather than a figure. Pinned here so that if someone
    // later decides these SHOULD be judged, this test is where the decision lands.
    expect(owesReviewRow('Revert "feat(x): thing (BIN-1)"')).toBe(false);
    expect(owesReviewRow('update the thing')).toBe(false);
  });

  it('is anchored — a type named mid-subject does not count', () => {
    expect(owesReviewRow('docs: describe the feat(x): syntax')).toBe(false);
  });
});

describe('ticketsInSubject', () => {
  it('finds one, several, and deduplicates', () => {
    expect(ticketsInSubject('fix(a): thing (BIN-1)')).toEqual(['BIN-1']);
    expect(ticketsInSubject('feat(a): thing (BIN-1, BIN-2)')).toEqual(['BIN-1', 'BIN-2']);
    expect(ticketsInSubject('feat(a): BIN-1 thing (BIN-1)')).toEqual(['BIN-1']);
  });

  it('returns nothing when the subject names none', () => {
    expect(ticketsInSubject('feat(a): a thing with no ticket')).toEqual([]);
  });
});

describe('ticketsWithAReviewRow', () => {
  it('reads both the `ticket` field and the `tickets` array', () => {
    // One name, two spellings — the same schema drift README documents for
    // mustHaves/tier/panel. A reader that knew only one would report false gaps.
    const rows = [
      { type: 'review', ticket: 'BIN-1' },
      { type: 'review', tickets: ['BIN-2', 'BIN-3'] },
    ];
    expect([...ticketsWithAReviewRow(rows)].sort()).toEqual(['BIN-1', 'BIN-2', 'BIN-3']);
  });

  it('counts a `ran:false` row — the rule refuses SILENCE, not a recorded decision', () => {
    // BIN-917's criterion 4 accepts `ran:false` WITH a written pull-out reason. The reason
    // lives on the Linear ticket, where no check can read it; what this rule can see, and
    // all it claims to police, is whether anybody wrote anything down at all.
    const rows = [{ type: 'review', ticket: 'BIN-9', ran: false, outcome: 'declined-unattended' }];
    expect(ticketsWithAReviewRow(rows).has('BIN-9')).toBe(true);
  });

  it('finds the id in the PROSE when there is no `ticket` field — the real engine row shape', () => {
    // This case exists because the fixture above was a comfortable fiction. The sprint engine
    // lives out of tree and emits no `ticket` field at all, so the "a recorded decision is
    // acceptable" contract above was UNREACHABLE for rows of that shape. The fixture below is
    // that shape.
    //
    // Worse, the four rows from the 2026-08-16 incident are exactly this shape, which means
    // the first version of this module would have refused a commit naming BIN-880/906 with
    // the words "has no review row in events.jsonl at all" while four rows for those tickets
    // sat in the file. Resolving the id through check_events.mjs's `ticketOf` — one answer to
    // "which ticket is this row about?", shared by both readers — is what fixes it.
    const engineRow = {
      type: 'review', ran: false, outcome: 'declined-unattended-shipped',
      plan: 'BIN-880 — BUILT and committed with this review still owed, then parked In Review',
    };
    expect(ticketsWithAReviewRow([engineRow]).has('BIN-880')).toBe(true);
  });

  it('replays the real incident log and sees all four rows', () => {
    // True by construction rather than by fixture: read events.jsonl AS IT STOOD at 851696d,
    // the commit whose missing critique started this, and assert the four ids are visible.
    // A regression here means the module has gone back to reading only `row.ticket`.
    if (!historyIsAvailable()) return;
    const atIncident = execFileSync('git', ['show', '851696d:docs/org/metrics/events.jsonl'], {
      cwd: METRICS_DIR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    const seen = ticketsWithAReviewRow(parseEvents(atIncident));
    for (const id of ['BIN-880', 'BIN-906', 'BIN-908', 'BIN-909']) {
      expect(seen.has(id), `${id}'s row was in the log at 851696d and this reader cannot see it`).toBe(true);
    }
  });

  it('ignores non-review rows', () => {
    const rows = [
      { type: 'correction', ticket: 'BIN-1' },
      { type: 'retro', ticket: 'BIN-2' },
      { type: 'trigger', ticket: 'BIN-3' },
    ];
    expect(ticketsWithAReviewRow(rows).size).toBe(0);
  });
});

describe('parseGitLog — a subject is free text and must not be able to split a record', () => {
  // The real delimiters, built from char codes rather than written as escapes. A literal
  // NUL is invisible to a reader, and the first version of this block tried to spell one
  // with a broken `\u000` escape — which made the WHOLE FILE unparseable, so vitest
  // reported "no tests" for it and the suite total still looked healthy. That is the
  // silent-skip shape BIN-891 hit with a CRLF shebang, one cause further along.
  const NUL = String.fromCharCode(0);
  const SOH = String.fromCharCode(1);
  const record = (sha, date, subject) => `${sha}${NUL}${date}${NUL}${subject}${SOH}`;

  it('survives a subject containing newlines, tabs and pipes', () => {
    const subject = ['fix(x): a', 'subject', 'with|junk (BIN-1)'].join(
      String.fromCharCode(10) + String.fromCharCode(9),
    );
    const parsed = parseGitLog(record('abc123', '2026-08-19T12:00:00+02:00', subject));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sha).toBe('abc123');
    expect(parsed[0].subject).toBe(subject);
  });

  it('keeps two records apart, and keeps a NUL inside a subject with its own record', () => {
    // The field split is `sha NUL date NUL rest`, and `rest` is rejoined — so a NUL that
    // somehow reached a subject cannot shift the date into the subject slot or vice versa.
    const parsed = parseGitLog(
      record('aaa', '2026-08-19T12:00:00+02:00', `weird${NUL}subject`) +
      record('bbb', '2026-08-19T13:00:00+02:00', 'fix(x): normal (BIN-2)'),
    );
    expect(parsed.map((c) => c.sha)).toEqual(['aaa', 'bbb']);
    expect(parsed[0].date).toBe('2026-08-19T12:00:00+02:00');
    expect(parsed[0].subject).toBe(`weird${NUL}subject`);
  });

  it('returns nothing for empty input rather than inventing a commit', () => {
    expect(parseGitLog('')).toEqual([]);
  });
});

describe('findCoverageGaps', () => {
  const reviewed = new Set(['BIN-100', 'BIN-101']);

  it('passes a commit whose ticket has a row', () => {
    const r = findCoverageGaps([commit('a1', 'fix(x): thing (BIN-100)')], reviewed);
    expect(r.violations).toEqual([]);
    expect(r.eligible).toBe(1);
    expect(r.covered).toBe(1);
  });

  it('fails a commit whose ticket has NO row — the whole point', () => {
    const r = findCoverageGaps([commit('a2', 'fix(x): thing (BIN-999)')], reviewed);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].sha).toBe('a2');
    expect(r.violations[0].reason).toContain('BIN-999');
    expect(r.covered).toBe(0);
  });

  it('fails a commit that names SEVERAL tickets when only one is missing', () => {
    // The partial case. A rule keyed on "any ticket has a row" would pass this, and a batch
    // that closes three tickets under one commit is this repo's normal shape.
    const r = findCoverageGaps([commit('a3', 'feat(x): thing (BIN-100, BIN-999)')], reviewed);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].reason).toContain('BIN-999');
    expect(r.violations[0].reason).not.toContain('BIN-100');
  });

  it('fails a feat/fix with no ticket at all, as its own violation class', () => {
    const r = findCoverageGaps([commit('a4', 'fix(x): an untraceable change')], reviewed);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].reason).toContain('no BIN-id');
  });

  it('does not look at docs/chore commits at all', () => {
    const r = findCoverageGaps(
      [commit('a5', 'docs(map): thing (BIN-999)'), commit('a6', 'chore: sweep')],
      reviewed,
    );
    expect(r.violations).toEqual([]);
    expect(r.eligible).toBe(0);
  });

  it('grandfathers a feat/fix older than the epoch, and counts it', () => {
    const r = findCoverageGaps([commit('a7', 'fix(x): thing (BIN-999)', BEFORE)], reviewed);
    expect(r.violations).toEqual([]);
    expect(r.grandfathered).toBe(1);
    expect(r.eligible).toBe(0);
  });

  it('a shallow checkout asserts NOTHING — neither pass nor fail', () => {
    // A shallow checkout sits at depth 1. A history walk there sees one commit, so
    // every eligible commit would look absent. Reporting that as violations would turn
    // the run red; reporting it as clean would be a lie. It reports `unverified`.
    const r = findCoverageGaps([commit('a8', 'fix(x): thing (BIN-999)')], reviewed, {
      historyAvailable: false,
    });
    expect(r.unverified).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('THE FLOOR: an empty walk is a violation — a broken read must never read as clean', () => {
    const r = findCoverageGaps([], reviewed);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].sha).toBeNull();
    expect(r.violations[0].reason).toContain('ZERO commits');
  });

  it('…but an empty ELIGIBLE set is NOT a violation, and that distinction is deliberate', () => {
    // The deviation from the blind critique's literal wording, pinned so it cannot be
    // "corrected" back. On the day this rule shipped, the epoch was that same day, so no
    // commit could yet be after it. A floor on `eligible` would have failed the very commit
    // introducing the rule — the "punishes the first person to obey it" failure the sibling
    // check's own test file warns about. The read being broken and nothing being due are
    // different facts and this file refuses to conflate them.
    const r = findCoverageGaps([commit('a9', 'chore: nothing eligible here')], reviewed);
    expect(r.commitsWalked).toBe(1);
    expect(r.eligible).toBe(0);
    expect(r.violations).toEqual([]);
  });

  it('a commit landing EXACTLY on the epoch is judged, not grandfathered', () => {
    // The boundary. `Date.parse(commit.date) < epoch` is a strict inequality, and the test
    // reviewer measured that mutating it to `<=` survived 26/26 — no fixture sat on the
    // line. Reach is small (git timestamps are second-precision, the epoch is a literal
    // midnight) but "small reach" is how an off-by-one earns its place in a codebase.
    // Inclusive is the correct side: the epoch means "from this instant onwards".
    const onTheEpoch = commit('e1', 'fix(x): thing (BIN-999)', EPOCH);
    const r = findCoverageGaps([onTheEpoch], reviewed, { effectiveFrom: EPOCH });
    expect(r.grandfathered, 'a commit exactly on the epoch was skipped as older than it').toBe(0);
    expect(r.eligible).toBe(1);
    expect(r.violations).toHaveLength(1);

    // …and one millisecond earlier really is outside, so the boundary is a boundary and not
    // simply "everything counts".
    const justBefore = commit('e2', 'fix(x): thing (BIN-999)', new Date(Date.parse(EPOCH) - 1).toISOString());
    const before = findCoverageGaps([justBefore], reviewed, { effectiveFrom: EPOCH });
    expect(before.grandfathered).toBe(1);
    expect(before.eligible).toBe(0);
    expect(before.violations).toEqual([]);
  });

  it('the epoch is honoured from the parameter, not from a captured constant', () => {
    // Guards against the rule being keyed on a stale inlined date if the export is renamed.
    const mid = '2026-08-10T00:00:00.000Z';
    const commits = [commit('b1', 'fix(x): thing (BIN-999)', '2026-08-05T00:00:00Z')];
    expect(findCoverageGaps(commits, reviewed, { effectiveFrom: mid }).grandfathered).toBe(1);
    expect(findCoverageGaps(commits, reviewed, { effectiveFrom: BEFORE }).violations).toHaveLength(1);
  });
});

describe('gradeSubject — the COMMIT-TIME half (BIN-917 criterion 4)', () => {
  const reviewed = new Set(['BIN-100']);

  it('passes a code-changing subject whose every ticket has a row', () => {
    const v = gradeSubject('fix(org): a thing (BIN-100)', reviewed);
    expect(v.ok).toBe(true);
    expect(v.tickets).toEqual(['BIN-100']);
  });

  it('REFUSES a code-changing subject whose ticket has no row', () => {
    const v = gradeSubject('feat(x): a thing (BIN-999)', reviewed);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('BIN-999');
  });

  it('refuses when only ONE of several tickets is missing', () => {
    // The partial case, which a rule keyed on "any ticket has a row" would wave through —
    // and this repo ships multi-ticket commits as a matter of course.
    const v = gradeSubject('fix(org): two things (BIN-100, BIN-999)', reviewed);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('BIN-999');
    expect(v.reason).not.toContain('BIN-100');
  });

  it('refuses a code-changing subject that names no ticket at all', () => {
    const v = gradeSubject('fix(org): untraceable', reviewed);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('no BIN-id');
  });

  it('lets a docs/chore subject through, ticket or not', () => {
    // Gating routine automation at COMMIT time is how a developer learns to type LEFTHOOK=0,
    // which disables every hook including the two real ones. The denominator matters more
    // here than in the history mode, not less.
    expect(gradeSubject('docs(map): re-trace (BIN-999)', reviewed).ok).toBe(true);
    expect(gradeSubject('chore(janitor): sweep', reviewed).ok).toBe(true);
  });

  it('agrees with the history rule about what owes a row', () => {
    // Two graders, one denominator. If they ever disagree, a commit passes the hook and then
    // fails `npm run test:process` — the "two answers to one question" defect, split across
    // two modes. The commit-time grade is held against the history grade of the same commit
    // dated after the decision-1 epoch, where both apply the rule in force.
    const gates = [{ name: 'fixture', patterns: ['^src/lib/firebase/'] }];
    const after = new Date(Date.parse(REVIEW_SCOPE_EFFECTIVE_FROM) + 60_000).toISOString();
    const cases = [
      ['test(radering): pinna felet (BIN-100)', ['src/lib/firebase/userDocWrite.ts'], []],
      ['refactor(push): move a port (BIN-100)', ['src/lib/push.ts'], []],
      ['fix(ui): a thing', ['src/components/ui/Button.tsx'], []],
      ['fix(ui): a new screen', ['src/app/ny/page.tsx'], ['src/app/ny/page.tsx']],
      ['feat(ui): a thing', ['src/components/ui/Button.tsx'], []],
      ['docs(map): re-trace (BIN-100)', ['docs/workflow-map.html'], []],
      ['docs(rules): a comment', ['firestore.rules'], []],
      ['chore: sweep', ['lefthook.yml'], []],
      ['chore: sweep', ['tasks/todo.md'], []],
    ];
    let owedSeen = 0;
    for (const [subject, files, added] of cases) {
      const owes = owesReview({ subject, files, added, gates });
      owedSeen += owes ? 1 : 0;
      expect(gradeSubject(subject, new Set(), files, { added, gates }).ok, subject).toBe(!owes);
      const history = findCoverageGaps([{ sha: 'h1', date: after, subject, files, added }], new Set(), {
        gatesAt: () => new Map([['h1', gates]]),
      });
      expect(history.violations.length, subject).toBe(owes ? 1 : 0);
    }
    // Both directions are exercised, or the loop proves nothing.
    expect(owedSeen).toBeGreaterThan(0);
    expect(owedSeen).toBeLessThan(cases.length);
  });
});

describe('mainMessage — the exit code the commit-msg hook acts on', () => {
  // The test reviewer found this branch untested and PROVED it by inverting it: the whole
  // suite stayed green with the hook's verdict backwards. That is survivable on a reporting
  // script and is not survivable here — an inverted commit gate either blocks every clean
  // commit or waves through every violating one, silently.
  // Its two siblings (check-public-env, gen-ownership-map) have the same gap; this is the
  // first one on a gate that runs before a commit, so it is the first one worth closing.
  const tmp = (name, body) => {
    const p = join(tmpdir(), `binge-bin917-${name}-${process.pid}.txt`);
    writeFileSync(p, body, 'utf8');
    return p;
  };
  // Every input handed in, so the verdict cannot depend on what happens to be staged in the
  // checkout running the suite. A gated file makes a code type owe a row under decision 1.
  const GATED = ['src/lib/firebase/friends.ts'];
  const inputs = { added: [], gatesRead: { gates: [{ name: 'fixture', patterns: ['^src/lib/firebase/'] }], source: 'a fixture' } };

  it('exits 0 for a subject whose tickets all have rows', () => {
    // BIN-917 itself: this very batch logged its row, so the live log answers for it.
    const p = tmp('ok', 'fix(org): a thing (BIN-917)\n\nbody\n');
    try {
      expect(mainMessage(p, GATED, inputs)).toBe(0);
    } finally { rmSync(p, { force: true }); }
  });

  it('exits 1 for a subject naming a ticket with no row', () => {
    const p = tmp('bad', 'fix(org): a thing (BIN-9999999)\n');
    try {
      expect(mainMessage(p, GATED, inputs)).toBe(1);
    } finally { rmSync(p, { force: true }); }
  });

  it('exits 1 for a code-changing subject naming no ticket', () => {
    const p = tmp('noid', 'feat(x): untraceable\n');
    try {
      expect(mainMessage(p, [], inputs)).toBe(1);
    } finally { rmSync(p, { force: true }); }
  });

  it('exits 0 for a docs subject, and reads only the FIRST line', () => {
    // The body is where a ticket id most often appears in this repo's history, and reading it
    // would make the hook demand rows for follow-up doc fixes. Proven, not assumed: the body
    // below names an unreviewed ticket and the commit is still allowed.
    const p = tmp('docs', 'docs(map): re-trace\n\nRefs BIN-9999999 in the body only.\n');
    try {
      expect(mainMessage(p, GATED, inputs)).toBe(0);
    } finally { rmSync(p, { force: true }); }
  });

  it('exits 0 for an ordinary fix that names no ticket at all (decision 1)', () => {
    const p = tmp('ordinary', 'fix(ui): knappen stod snett\n');
    try {
      expect(mainMessage(p, ['src/components/ui/DuotonePoster.tsx'], inputs)).toBe(0);
      expect(mainMessage(p, GATED, inputs), 'the same subject on a gated file must still be refused').toBe(1);
    } finally { rmSync(p, { force: true }); }
  });
});

describe('stagedEventsLog — the gate reads the INDEX, not the working tree', () => {
  // This block exists because the test reviewer mutated the function away entirely — replacing
  // it with a plain worktree read — and all 39 tests stayed green. Every other fixture points
  // at THIS repo, where the index and the worktree agree, so the distinction the function
  // exists for was never exercised. A guard whose whole point is unobserved by its tests is
  // the vacuity this batch has now hit three separate times.
  //
  // Proving it needs a repo where the two genuinely differ, so these cases build a throwaway
  // one. What is at stake, concretely: `shared-plugin.json` waves `events.jsonl` through
  // `cleanTreeIgnore`, and the sprint engine writes its review rows WITHOUT staging them. A
  // worktree-reading hook would see such a row, pass the commit, and let the row never land —
  // then the deploy walks the committed history and goes red for a commit the gate cleared.
  const git = (repo, ...args) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

  /** A real git repo with `rel` committed, then STAGED as `staged`, then dirtied as `worktree`. */
  const scratchRepo = (name, { committed, staged, worktree }) => {
    const repo = mkdtempSync(join(tmpdir(), `binge-bin917-${name}-`));
    const rel = 'docs/org/metrics/events.jsonl';
    mkdirSync(join(repo, 'docs', 'org', 'metrics'), { recursive: true });
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@example.invalid');
    git(repo, 'config', 'user.name', 'test');
    writeFileSync(join(repo, rel), committed, 'utf8');
    git(repo, 'add', rel);
    git(repo, 'commit', '-q', '-m', 'seed');
    if (staged !== undefined) {
      writeFileSync(join(repo, rel), staged, 'utf8');
      git(repo, 'add', rel);
    }
    if (worktree !== undefined) writeFileSync(join(repo, rel), worktree, 'utf8');
    return { repo, rel };
  };

  const row = (ticket) => JSON.stringify({ type: 'review', ticket }) + '\n';

  it('returns the STAGED bytes when the working tree has diverged', () => {
    const { repo, rel } = scratchRepo('staged', {
      committed: row('BIN-1'),
      staged: row('BIN-2'),
      worktree: row('BIN-3'),
    });
    try {
      const log = stagedEventsLog(repo, rel);
      expect(log.source).toContain('index');
      // The decisive assertion: BIN-2 is staged, BIN-3 is on disk. A worktree read returns
      // BIN-3 and this fails — which is exactly the mutant that used to survive.
      expect(ticketsWithAReviewRow(parseEvents(log.text)).has('BIN-2')).toBe(true);
      expect(ticketsWithAReviewRow(parseEvents(log.text)).has('BIN-3')).toBe(false);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  it('does NOT see a row that was written but never staged — the sprint-engine case', () => {
    // The scenario in the wild, stated as its own case because it is the one that matters:
    // the row exists on disk and is invisible to the gate until someone stages it.
    const { repo, rel } = scratchRepo('unstaged', {
      committed: row('BIN-1'),
      worktree: row('BIN-1') + row('BIN-999'),
    });
    try {
      const seen = ticketsWithAReviewRow(parseEvents(stagedEventsLog(repo, rel).text));
      expect(seen.has('BIN-1')).toBe(true);
      expect(seen.has('BIN-999'), 'an unstaged row must not satisfy the commit gate').toBe(false);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  it('the PRODUCTION defaults compose back to the real file', () => {
    // Asserted DIRECTLY, without git. The first version of this test called
    // `stagedEventsLog(undefined, DEFAULT_EVENTS_REL)` and its comment claimed that forced the
    // fallback. It did not: that relPath is the real tracked file, so `git show :<relPath>`
    // succeeds from any cwd inside the repo and the git branch wins — the `join()` under test
    // is never evaluated. A test whose comment describes work it does not do is the defect
    // that batch was about.
    //
    // The module asserts the same invariant at import (and that DOES fail loud — measured:
    // `Test Files 1 failed (1)`, exit 1). This is the copy that survives someone deleting it.
    expect(join(REPO_ROOT, DEFAULT_EVENTS_REL)).toBe(EVENTS_PATH);
  });

  it('REPO_ROOT is the repo root — the git branch tolerates a wrong one, the fallback does not', () => {
    // Why the assertion above is not pedantry. `git show :<path>` resolves against the top of
    // the worktree, so it works from ANY directory inside the repo; `join(repoDir, relPath)`
    // does not. That asymmetry is exactly what let the first parameterisation ship with
    // `repoDir` defaulting to the metrics directory: the git branch worked, the fallback threw
    // ENOENT on `docs/org/metrics/docs/org/metrics/events.jsonl`, and the docblock promised a
    // fallback that could not run. Pinned from both sides so the two meanings cannot drift.
    expect(REPO_ROOT).toBe(dirname(dirname(dirname(METRICS_DIR))));
    expect(join(METRICS_DIR, DEFAULT_EVENTS_REL)).not.toBe(EVENTS_PATH);
  });

  it('falls back to the working tree, and SAYS so, when the index cannot be read', () => {
    // Not a git repo at all: `git show :path` fails, the fallback reads the file, and the
    // announced source must not claim the index. An unannounced fallback is how the
    // false-pass this whole function prevents would come back in disguise.
    const dir = mkdtempSync(join(tmpdir(), 'binge-bin917-nogit-'));
    const rel = 'events.jsonl';
    try {
      writeFileSync(join(dir, rel), row('BIN-7'), 'utf8');
      const log = stagedEventsLog(dir, rel);
      expect(log.source).toContain('WORKING TREE');
      expect(log.source).not.toContain('index (what');
      expect(ticketsWithAReviewRow(parseEvents(log.text)).has('BIN-7')).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// BIN-1263: the real-history walk shells out to git and reads the whole events log.
// Alone it finishes well inside the 5 000 ms default; in a full-suite run on a loaded
// machine it has been measured past it, which turned a full-suite run red for a busy
// CPU. Its own clock, not a global one.
const LIVE_WALK_TIMEOUT_MS = 30_000;

describe('the live repo', () => {
  it('every feat/fix commit since the epoch carries a review row', () => {
    // The real log and the real history, the way the sibling's live case works.
    //
    // It runs under `npm run test:process`, which deploy.yml runs as a warning (BIN-1426),
    // so the next feat/fix commit that ships without anyone logging a review row turns
    // this red. The remedy is to LOG THE ROW (`ran:true`, or `ran:false` with the
    // pull-out reason written on the ticket), never to weaken the rule to clear it.
    //
    // On its first run this found two: 634d62e (BIN-565) and 2e5993a (BIN-911), whose
    // critiques demonstrably ran — the sprint plan at 6d157c5 records #18/#27 and #19/#5
    // with their verdicts and binding conditions — and were simply never written to the
    // log. Exactly the failure class, found by the check rather than by an incident.
    if (!historyIsAvailable()) return; // depth-1 checkout: the module asserts nothing, nor does this

    const reviewed = ticketsWithAReviewRow(parseEvents(readFileSync(EVENTS_PATH, 'utf8')));
    // BIN-1040: the exemption inputs go HERE too, from the SAME builder `main()` uses.
    // Nothing automated calls `main()` — `lefthook.yml` invokes the `--message` mode — and
    // the path deploy.yml runs is `npm run test:process` reaching this assertion.
    // Wiring the exemption into `main()` alone left the defect exactly where it was reported from,
    // under a docblock saying it was fixed. Found by the integration review before this
    // shipped; "check WHERE the rule runs, not only where it was written" (BIN-744/776/917).
    const result = findCoverageGaps(readGitLog(), reviewed, exemptionInputs(true));

    expect(
      result.violations.map(v => `${v.sha ?? '(whole walk)'} — ${v.reason}`),
      'a commit reached main with no stakeholder-review row; log one rather than weakening this',
    ).toEqual([]);
  }, LIVE_WALK_TIMEOUT_MS);

  it('the walk is not silently empty, and the epoch is not in the future', () => {
    // Anti-vacuity, the shape BIN-838/823/850 taught. Floors, not equalities: history grows.
    if (!historyIsAvailable()) return;

    const commits = readGitLog();
    expect(commits.length, 'the git-log walk returned almost nothing — the format stopped parsing')
      .toBeGreaterThanOrEqual(500);
    expect(
      commits.filter(c => owesReviewRow(c.subject)).length,
      'no commit in the whole history looks like a feat/fix — the denominator regex is dead',
    ).toBeGreaterThanOrEqual(200);
    expect(
      Date.parse(EPOCH),
      'the epoch is in the future, so this rule can never judge anything',
    ).toBeLessThanOrEqual(Date.now());
  });
});

describe('the dependabot exemption (BIN-1040)', () => {
  const reviewed = new Set(['BIN-100']);
  const BOT = new Set(['bot1']);

  // The prefixes as the REAL config declares them, so every case below is driven by the
  // same derivation the gate runs — never by a list retyped into this file.
  const PREFIXES = readDependabotPrefixes();

  it('derives exactly the prefixes .github/dependabot.yml declares today', () => {
    // The pin #25's blind critique asked for. There is no YAML parser in this repo, so the
    // derivation is a text scan; a re-quoting, a renamed prefix or a new ecosystem block
    // must fail HERE rather than silently mis-derive and re-arm the trap under a new name.
    // Sorted, because the scan reports file order and file order is not the contract.
    expect(PREFIXES.slice().sort()).toEqual(['ci', 'deps', 'deps(functions)']);
  });

  it('reads a quoted, an unquoted and a single-quoted prefix, and ignores prose', () => {
    expect(dependabotPrefixesFrom([
      '    commit-message:',
      '      prefix: "ci"',
      '      prefix: deps',
      "      prefix: 'deps(functions)'",
      '      # prefix: not-a-real-one',
      '      description: the prefix: word inside prose must not match',
    ].join('\n'))).toEqual(['ci', 'deps', 'deps(functions)']);
  });

  it('exempts a dependabot Actions bump — the defect BIN-1040 was filed about', () => {
    // Before this, merging one of these turned the deploy red and then blocked unrelated
    // code until somebody hand-wrote a review row for a commit nobody wrote.
    const r = findCoverageGaps(
      [commit('bot1', 'ci(deps): bump actions/checkout from 4 to 7 (#37)')],
      reviewed,
      { botShas: BOT, dependabotPrefixes: PREFIXES },
    );
    expect(r.violations).toEqual([]);
    expect(r.eligible, 'an exempt commit is not eligible, so it cannot be counted as covered')
      .toBe(0);
  });

  it('still charges an ordinary ci(...) scope even from the bot — the SUBJECT half of the AND', () => {
    // The scope half. `bot1` IS in `botShas`, so authorship alone would exempt this; the
    // `deps` scope requirement is the only thing charging it, which is what keeps the
    // exemption to version bumps rather than to everything the bot could ever author.
    const r = findCoverageGaps(
      [commit('bot1', 'ci(workflows): byt node-version (BIN-999)')],
      reviewed,
      { botShas: BOT, dependabotPrefixes: PREFIXES },
    );
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].reason).toContain('BIN-999');
  });

  it('still charges the bot SUBJECT FORM when git did not attribute it to the bot', () => {
    // `ci(deps): …` is text a human can type. Authorship is asked of git, never read off
    // the subject line, so an identical subject from a human author stays inside the rule.
    const r = findCoverageGaps(
      [commit('human1', 'ci(deps): bump actions/checkout from 4 to 7')],
      reviewed,
      { botShas: BOT, dependabotPrefixes: PREFIXES },
    );
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].reason).toContain('no BIN-id');
  });

  it('charges a bot-authored commit whose subject is not a dependency bump at all', () => {
    const r = findCoverageGaps(
      [commit('bot1', 'feat(x): something the bot did not bump (BIN-999)')],
      reviewed,
      { botShas: BOT, dependabotPrefixes: PREFIXES },
    );
    expect(r.violations).toHaveLength(1);
  });

  it('grades exactly as before when no exemption inputs are passed', () => {
    // The defaults must mean "nothing is exempt".
    const r = findCoverageGaps([commit('bot1', 'ci(deps): bump actions/checkout from 4 to 7')], reviewed);
    expect(r.violations).toHaveLength(1);
  });

  it('leaves owesReviewRow itself untouched, so the commit-msg hook still refuses', () => {
    // `gradeSubject` grades a commit that does not exist yet and therefore has no author.
    // It must not inherit the exemption: a human typing this subject still owes a row.
    expect(owesReviewRow('ci(deps): bump actions/checkout from 4 to 7')).toBe(true);
    expect(gradeSubject('ci(deps): bump actions/checkout from 4 to 7', reviewed).ok).toBe(false);
  });

  it('the npm ecosystems never tripped the rule, and still do not', () => {
    // Measured on the real config: only the `github-actions` block's `ci` prefix is inside
    // `OWES_REVIEW` at all. Pinned so a future widening of the denominator is noticed here.
    expect(owesReviewRow('deps(deps-dev): bump eslint from 9.39.4 to 10.7.0')).toBe(false);
    expect(owesReviewRow('deps(functions)(deps): bump firebase-admin')).toBe(false);
  });

  it('an unreadable dependabot.yml exempts NOTHING rather than everything', () => {
    // Direction matters: failing open here would widen who escapes the rule.
    expect(readDependabotPrefixes(mkdtempSync(join(tmpdir(), 'no-dependabot-')))).toEqual([]);
  });

  it('this repo really does have bot-authored commits, so the gate is not theoretical', () => {
    if (!historyIsAvailable()) return;
    expect(
      readBotBumpShas().size,
      'git attributes no commit to dependabot[bot] — either the author spelling changed or '
      + 'the exemption is now guarding nothing and should be re-anchored, not deleted quietly',
    ).toBeGreaterThan(0);
  });
});

describe('reviewer instructions owe a review row whatever the type (BIN-959 del 3)', () => {
  const reviewed = new Set(['BIN-100']);
  const INSTR = '.claude/agents/binge-code-reviewer.md';
  const AFTER_INSTR = '2026-09-20T12:00:00.000Z';
  const BEFORE_INSTR = '2026-09-18T12:00:00.000Z';

  it('matches the four instruction files and never a knowledge file', () => {
    for (const f of [
      '.claude/agents/binge-code-reviewer.md',
      '.claude/agents/binge-security-reviewer.md',
      '.claude/agents/binge-test-reviewer.md',
      '.claude/agents/binge-integration-reviewer.md',
    ]) expect(REVIEWER_INSTRUCTIONS.test(f), f).toBe(true);
    for (const f of [
      '.claude/agents/binge-code-reviewer.knowledge.md',
      '.claude/agents/binge-code-reviewer.data.knowledge.md',
      '.claude/agents/binge-code-reviewer.knowledge.archive.md',
      'docs/.claude/agents/binge-code-reviewer.md',
    ]) expect(REVIEWER_INSTRUCTIONS.test(f), f).toBe(false);
  });

  it('the instruction files it names exist, so the pattern is not guarding nothing', () => {
    const tracked = execFileSync('git', ['ls-files', '.claude/agents'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split(/\r?\n/).filter(Boolean);
    expect(tracked.filter((f) => REVIEWER_INSTRUCTIONS.test(f)).length).toBeGreaterThanOrEqual(4);
  });

  it('refuses a docs commit that changes an instruction file and names a ticket with no row', () => {
    const v = gradeSubject('docs(agents): reword a step (BIN-999)', reviewed, [INSTR]);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('BIN-999');
  });

  it('refuses a docs commit that changes an instruction file and names no ticket', () => {
    const v = gradeSubject('docs(agents): reword a step', reviewed, [INSTR]);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('no BIN-id');
  });

  it('passes the same docs commit when its ticket has a row', () => {
    expect(gradeSubject('docs(agents): reword a step (BIN-100)', reviewed, [INSTR]).ok).toBe(true);
  });

  it('still lets a docs commit through when it touches only knowledge files', () => {
    expect(gradeSubject('docs(agents): fold a lesson', reviewed,
      ['.claude/agents/binge-code-reviewer.knowledge.md']).ok).toBe(true);
  });

  it('history: judges a docs commit by its files only from the instructions epoch on', () => {
    const filesOf = (sha) => (sha.startsWith('i') ? [INSTR] : ['docs/x.md']);
    const commits = [
      commit('i1', 'docs(agents): reword (BIN-999)', AFTER_INSTR),
      commit('i2', 'docs(agents): reword', AFTER_INSTR),
      commit('i3', 'docs(agents): reword (BIN-999)', BEFORE_INSTR),
      commit('d1', 'docs(map): unrelated (BIN-999)', AFTER_INSTR),
    ];
    const r = findCoverageGaps(commits, reviewed, { filesOf });
    expect(r.violations.map((v) => v.sha)).toEqual(['i1', 'i2']);
    expect(r.eligible).toBe(2);
  });

  it('history: a commit landing EXACTLY on the instructions epoch is judged, one ms earlier is not', () => {
    // The sibling epoch carries the same pair for the same reason: a `<` turned `<=`
    // survives every case that sits comfortably on either side of the line.
    const filesOf = () => [INSTR];
    const onIt = commit('e1', 'docs(agents): reword (BIN-999)', INSTRUCTIONS_EFFECTIVE_FROM);
    const justBefore = commit('e2', 'docs(agents): reword (BIN-999)',
      new Date(Date.parse(INSTRUCTIONS_EFFECTIVE_FROM) - 1).toISOString());
    expect(findCoverageGaps([onIt], reviewed, { filesOf }).violations.map((v) => v.sha)).toEqual(['e1']);
    expect(findCoverageGaps([justBefore], reviewed, { filesOf }).violations).toEqual([]);
  });

  it('history: a caller that passes no filesOf grades exactly as before', () => {
    const r = findCoverageGaps([commit('i1', 'docs(agents): reword (BIN-999)', AFTER_INSTR)], reviewed);
    expect(r.violations).toEqual([]);
    expect(r.eligible).toBe(0);
  });

  it('the instructions epoch is not before the day the rule was decided', () => {
    // Non-retroactive, like BIN-938's epoch: an earlier date would grade docs commits that
    // were legal under the rule of their day.
    expect(Date.parse(INSTRUCTIONS_EFFECTIVE_FROM)).toBeGreaterThanOrEqual(Date.parse('2026-09-19T00:00:00.000Z'));
    expect(Date.parse(INSTRUCTIONS_EFFECTIVE_FROM)).toBeLessThanOrEqual(Date.now());
  });

  it('filesOfCommit reads a real commit, and the history builder hands it to both callers', () => {
    if (!historyIsAvailable()) return;
    const sha = execFileSync('git', ['log', '-1', '--format=%H', '--', INSTR], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    expect(filesOfCommit(sha)).toContain(INSTR);
    expect(exemptionInputs(true).filesOf(sha)).toContain(INSTR);
  });

  it('mainMessage refuses by the STAGED files, not only the subject', () => {
    const p = join(tmpdir(), `binge-bin959-${process.pid}.txt`);
    writeFileSync(p, 'docs(agents): reword a step (BIN-9999999)\n', 'utf8');
    try {
      // Nothing read from the index of the checkout running the suite: no added files, and
      // the gates as this commit ships them.
      const inputs = { added: [], gatesRead: { gates: readReviewGates(), source: 'the config' } };
      expect(mainMessage(p, [INSTR], inputs)).toBe(1);
      expect(mainMessage(p, ['docs/x.md'], inputs)).toBe(0);
    } finally { rmSync(p, { force: true }); }
  });

  it('stagedFiles reads the index of the repo it is pointed at', () => {
    const repo = mkdtempSync(join(tmpdir(), 'binge-bin959-staged-'));
    const run = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      run('init', '-q');
      mkdirSync(join(repo, '.claude', 'agents'), { recursive: true });
      writeFileSync(join(repo, INSTR), 'x\n', 'utf8');
      writeFileSync(join(repo, 'unstaged.md'), 'y\n', 'utf8');
      run('add', INSTR);
      expect(stagedFiles(repo)).toEqual([INSTR]);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  it('mainMessage reads the staged files, the added files and the staged gates by default', () => {
    // BIN-852's shape: a check that is only ever handed its input by a test can be unwired
    // from the entry point with the whole suite green. Pin the default parameters themselves,
    // and the call that passes them on, read from mainMessage's own body.
    const src = readFileSync(join(METRICS_DIR, 'check_review_coverage.mjs'), 'utf8');
    const body = src.slice(src.indexOf('export function mainMessage('));
    expect(body).toMatch(
      /^export function mainMessage\(\s*messagePath,\s*staged = stagedFiles\(\),\s*\{ added = stagedAddedFiles\(\), gatesRead = stagedReviewGates\(\) \} = \{\},?\s*\)/,
    );
    expect(body).toMatch(/gradeSubject\(subject, reviewed, staged, \{ added, gates: gatesRead\.gates \}\)/);
  });
});

describe('TICKET_BY_SHA — a pushed commit whose subject lost its id', () => {
  const reviewed = new Set(['BIN-100']);
  const SHA = 'a'.repeat(40);

  it('attributes the listed sha to its ticket, which then counts as covered', () => {
    const r = findCoverageGaps([commit(SHA, 'refactor(x): no id here')], reviewed, {
      ticketBySha: new Map([[SHA, 'BIN-100']]),
    });
    expect(r.violations).toEqual([]);
    expect(r.covered).toBe(1);
  });

  it('still charges the attributed ticket when it has no review row — attribution is not exemption', () => {
    const r = findCoverageGaps([commit(SHA, 'refactor(x): no id here')], reviewed, {
      ticketBySha: new Map([[SHA, 'BIN-999']]),
    });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].reason).toContain('BIN-999');
  });

  it('matches the FULL sha only — an abbreviated key attributes nothing', () => {
    const r = findCoverageGaps([commit(SHA, 'refactor(x): no id here')], reviewed, {
      ticketBySha: new Map([[SHA.slice(0, 8), 'BIN-100']]),
    });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].reason).toContain('no BIN-id');
  });

  it('is ignored when the subject names an id, so it cannot relabel a named commit', () => {
    const r = findCoverageGaps([commit(SHA, 'fix(x): thing (BIN-999)')], reviewed, {
      ticketBySha: new Map([[SHA, 'BIN-100']]),
    });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].reason).toContain('BIN-999');
  });

  it('attributes nothing by default', () => {
    const r = findCoverageGaps([commit(SHA, 'refactor(x): no id here')], reviewed);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].reason).toContain('no BIN-id');
  });

  it('every entry is a full sha mapped to one BIN-id, and there is at least one', () => {
    expect(TICKET_BY_SHA.size).toBeGreaterThan(0);
    for (const [sha, ticket] of TICKET_BY_SHA) {
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      expect(ticket).toMatch(/^BIN-\d+$/);
    }
  });

  it('is wired into exemptionInputs, the builder both callers use', () => {
    expect(exemptionInputs(true).ticketBySha).toBe(TICKET_BY_SHA);
    expect(exemptionInputs(false).ticketBySha).toBe(TICKET_BY_SHA);
  });

  it('every live entry is in history, names no id, and is load-bearing', () => {
    if (!historyIsAvailable()) return;
    const log = readGitLog();
    const reviewedLive = ticketsWithAReviewRow(parseEvents(readFileSync(EVENTS_PATH, 'utf8')));
    const inputs = exemptionInputs(true);
    for (const [sha, ticket] of TICKET_BY_SHA) {
      const found = log.find((c) => c.sha === sha);
      expect(found, `${sha} is not in this history`).toBeDefined();
      expect(ticketsInSubject(found.subject), `${sha} already names an id`).toEqual([]);
      expect(reviewedLive.has(ticket), `${ticket} has no review row`).toBe(true);
      const withIt = findCoverageGaps([found], reviewedLive, inputs);
      const without = findCoverageGaps([found], reviewedLive, { ...inputs, ticketBySha: new Map() });
      expect(withIt.violations, `${sha} is not covered with its entry`).toEqual([]);
      expect(without.violations, `${sha}'s entry changes nothing`).toHaveLength(1);
    }
  }, LIVE_WALK_TIMEOUT_MS);
});

describe('decision 1 (BIN-1426): who owes a review row', () => {
  // Malin's decision 1, 2026-10-05: critiques and reviewer agents only for database rules,
  // sign-in, personal data, server functions and new features; ordinary fixes ship on
  // typecheck and tests. Fixture gates keep these cases independent of the real config; the
  // block further down holds the real config to the same answers.
  const reviewed = new Set(['BIN-100']);
  const GATES = [{ name: 'fixture', patterns: ['^src/lib/firebase/'] }];
  const ORDINARY = ['src/components/ui/DuotonePoster.tsx'];
  const GATED = ['src/lib/firebase/friends.ts'];
  const EPOCH_MS = Date.parse(REVIEW_SCOPE_EFFECTIVE_FROM);
  const AFTER_SCOPE = new Date(EPOCH_MS + 3_600_000).toISOString();
  const BEFORE_SCOPE = new Date(EPOCH_MS - 3_600_000).toISOString();
  const grade = (subject, files, added = []) => gradeSubject(subject, reviewed, files, { added, gates: GATES });

  it('an ordinary fix passes without a BIN-id', () => {
    const v = grade('fix(ui): knappen stod snett', ORDINARY);
    expect(v.ok).toBe(true);
    expect(v.owed).toBeNull();
  });

  it('a fix that touches a gated file is refused without one, and the refusal names the file', () => {
    const v = grade('fix(data): vänlistan', GATED);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('no BIN-id');
    expect(v.reason).toContain(GATED[0]);
    expect(grade('fix(data): vänlistan (BIN-100)', GATED).ok).toBe(true);
  });

  it('a feat is refused without one even when every file is ordinary', () => {
    const v = grade('feat(ui): en ny knapp', ORDINARY);
    expect(v.ok).toBe(false);
    expect(v.owed).toContain('feat');
  });

  it('an ADDED page makes any commit a feature; a changed page or another added file does not', () => {
    const page = 'src/app/ny/page.tsx';
    expect(grade('fix(ui): ny sida', [page], [page]).ok).toBe(false);
    expect(grade('fix(ui): ny sida', [page], [page]).owed).toContain(page);
    expect(grade('chore: ny sida', [page], [page]).ok, 'the page clause must not depend on the type').toBe(false);
    expect(grade('fix(ui): en rad på sidan', [page], []).ok).toBe(true);
    expect(grade('fix(ui): ny layout', ['src/app/ny/layout.tsx'], ['src/app/ny/layout.tsx']).ok).toBe(true);
    expect(isFeature('fix: x', ['src/app/page.tsx']), 'the root page is a page too').toBe(true);
    expect(isFeature('fix: x', ['src/components/page.tsx'])).toBe(false);
    expect(isFeature('feat(x)!: y')).toBe(true);
    expect(isFeature('docs: describe the feat(x): syntax')).toBe(false);
  });

  it('a non-code type touching a gated file owes nothing — the gate clause needs a code type', () => {
    expect(grade('docs(data): en kommentar', GATED).ok).toBe(true);
  });

  it('a docs commit touching a TYPE_FREE path is refused without a BIN-id', () => {
    for (const file of ['firestore.rules', 'src/contexts/AuthContext.tsx', 'docs/org/route.mjs', 'lefthook.yml',
      '.claude/shared-plugin.json', 'docs/org/metrics/check_staged_routing.mjs']) {
      const v = grade('docs: en kommentar', [file]);
      expect(v.ok, file).toBe(false);
      expect(v.owed, file).toContain(file);
    }
  });

  it('unreadable gates make a code type owe a row, as it did before decision 1', () => {
    for (const gates of [null, undefined, []]) {
      const v = gradeSubject('fix(ui): knappen', reviewed, ORDINARY, { gates });
      expect(v.ok, String(gates)).toBe(false);
      expect(v.owed).toContain('could not be read');
    }
    expect(gradeSubject('docs: en rad', reviewed, ORDINARY, { gates: null }).ok).toBe(true);
  });

  it('every high-stakes path in route.mjs is TYPE_FREE', () => {
    // The two lists are written separately; this is what keeps a path added to HIGH_STAKES from
    // being critiqued before the build and then committed under `docs:` with no row.
    expect(HIGH_STAKES.length).toBeGreaterThan(0);
    for (const hs of HIGH_STAKES) {
      const path = hs.endsWith('/') ? `${hs}index.ts` : hs;
      expect(TYPE_FREE.some(({ pattern }) => pattern.test(path)), hs).toBe(true);
    }
  });

  it('every TYPE_FREE pattern matches a tracked file, so none of them guards nothing', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      .split(/\r?\n/).filter(Boolean);
    expect(tracked.length).toBeGreaterThan(500);
    for (const { pattern } of TYPE_FREE) {
      expect(tracked.some((f) => pattern.test(f)), String(pattern)).toBe(true);
    }
  });

  it('each TYPE_FREE entry binds only from its own date, and none from the future', () => {
    const instr = TYPE_FREE.filter(({ from }) => from === INSTRUCTIONS_EFFECTIVE_FROM);
    expect(instr.map(({ pattern }) => String(pattern))).toEqual([String(REVIEWER_INSTRUCTIONS)]);
    for (const { from } of TYPE_FREE) {
      expect([INSTRUCTIONS_EFFECTIVE_FROM, REVIEW_SCOPE_EFFECTIVE_FROM]).toContain(from);
    }
    expect(EPOCH_MS).toBeGreaterThanOrEqual(Date.parse('2026-10-05T00:00:00.000Z'));
    expect(EPOCH_MS).toBeLessThanOrEqual(Date.now());
  });

  it('history: a docs commit touching firestore.rules is graded after the epoch and not before it', () => {
    const commits = [
      { sha: 'r1', date: AFTER_SCOPE, subject: 'docs: en kommentar', files: ['firestore.rules'], added: [] },
      { sha: 'r2', date: BEFORE_SCOPE, subject: 'docs: en kommentar', files: ['firestore.rules'], added: [] },
    ];
    const r = findCoverageGaps(commits, reviewed);
    expect(r.violations.map((v) => v.sha)).toEqual(['r1']);
    expect(r.violations[0].reason).toContain('firestore.rules');
  });

  it('history: an ordinary fix with no id is fine after the epoch, and still owes under the rule of its day before it', () => {
    const fix = (sha, date) => ({ sha, date, subject: 'fix(ui): knappen', files: ORDINARY, added: [] });
    const gatesAt = (shas) => new Map(shas.map((sha) => [sha, GATES]));
    const r = findCoverageGaps([fix('o1', AFTER_SCOPE), fix('o2', BEFORE_SCOPE)], reviewed, { gatesAt });
    expect(r.violations.map((v) => v.sha)).toEqual(['o2']);
  });

  it('history: a commit EXACTLY on the epoch is graded by the new rule, one ms earlier by the old one', () => {
    const at = (ms) => new Date(ms).toISOString();
    const gatesAt = (shas) => new Map(shas.map((sha) => [sha, GATES]));
    const ordinary = (sha, ms) => ({ sha, date: at(ms), subject: 'fix(ui): knappen', files: ORDINARY, added: [] });
    const typeFree = (sha, ms) => ({ sha, date: at(ms), subject: 'chore: hooks', files: ['lefthook.yml'], added: [] });
    const r = findCoverageGaps([
      ordinary('on-o', EPOCH_MS), ordinary('pre-o', EPOCH_MS - 1),
      typeFree('on-t', EPOCH_MS), typeFree('pre-t', EPOCH_MS - 1),
    ], reviewed, { gatesAt });
    expect(r.violations.map((v) => v.sha).sort()).toEqual(['on-t', 'pre-o']);
  });

  it('history: each commit is graded by ITS OWN gates, so a later widening re-grades nothing', () => {
    const fix = { sha: 'g1', date: AFTER_SCOPE, subject: 'fix(data): x', files: GATED, added: [] };
    const narrow = [{ name: 'then', patterns: ['^nothing-matches$'] }];
    expect(findCoverageGaps([fix], reviewed, { gatesAt: () => new Map([['g1', narrow]]) }).violations).toEqual([]);
    expect(findCoverageGaps([fix], reviewed, { gatesAt: () => new Map([['g1', GATES]]) }).violations).toHaveLength(1);
    // A sha the reader could not resolve is graded as unreadable gates: the code type owes.
    expect(findCoverageGaps([fix], reviewed, { gatesAt: () => new Map() }).violations).toHaveLength(1);
  });

  it('history: gates are asked for only for commits on or after the epoch', () => {
    const asked = [];
    const gatesAt = (shas) => { asked.push(...shas); return new Map(); };
    findCoverageGaps([
      { sha: 'new', date: AFTER_SCOPE, subject: 'fix: x (BIN-100)', files: [], added: [] },
      { sha: 'old', date: BEFORE_SCOPE, subject: 'fix: x (BIN-100)', files: [], added: [] },
    ], reviewed, { gatesAt });
    expect(asked).toEqual(['new']);
  });

  it('exemptionInputs hands both callers the per-commit gate reader', () => {
    expect(exemptionInputs(true).gatesAt).toBe(reviewGatesAtCommits);
    expect(exemptionInputs(false).gatesAt(['x']).size).toBe(0);
  });
});

describe('parseGitLog — the --name-status section', () => {
  const NUL = String.fromCharCode(0);
  const SOH = String.fromCharCode(1);
  const STX = String.fromCharCode(2);
  const LF = String.fromCharCode(10);
  // The shape `readGitLog` asks git for: SOH, the three fields, STX, then `-z` name-status pairs.
  const record = (sha, date, subject, pairs) =>
    `${SOH}${sha}${NUL}${date}${NUL}${subject}${STX}${NUL}${LF}${pairs.flat().join(NUL)}${pairs.length ? NUL : ''}`;

  it('reads every path, and only an A into `added`', () => {
    const parsed = parseGitLog(record('abc', '2026-10-06T12:00:00+02:00', 'fix(x): y (BIN-1)', [
      ['M', 'src/a.ts'], ['A', 'src/app/ny/page.tsx'], ['D', 'src/gone.ts'],
    ]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].subject).toBe('fix(x): y (BIN-1)');
    expect(parsed[0].files).toEqual(['src/a.ts', 'src/app/ny/page.tsx', 'src/gone.ts']);
    expect(parsed[0].added).toEqual(['src/app/ny/page.tsx']);
  });

  it('a rename carries both of its paths, so neither end can hide', () => {
    const parsed = parseGitLog(record('abc', '2026-10-06T12:00:00+02:00', 'refactor: move', [
      ['R100', 'src/lib/firebase/friends.ts', 'src/lib/social/friends.ts'], ['M', 'src/b.ts'],
    ]));
    expect(parsed[0].files).toEqual(['src/lib/firebase/friends.ts', 'src/lib/social/friends.ts', 'src/b.ts']);
    expect(parsed[0].added).toEqual([]);
  });

  it('keeps several records apart, and an empty commit has no files rather than a stray one', () => {
    const parsed = parseGitLog(
      record('a1', '2026-10-06T12:00:00Z', 'chore: empty', [])
      + record('a2', '2026-10-06T13:00:00Z', 'fix: x', [['M', 'src/c.ts']]),
    );
    expect(parsed.map((c) => [c.sha, c.files])).toEqual([['a1', []], ['a2', ['src/c.ts']]]);
  });

  it('a record without the section still parses, with no file list at all', () => {
    const parsed = parseGitLog(`a3${NUL}2026-10-06T12:00:00Z${NUL}fix: x${SOH}`);
    expect(parsed).toEqual([{ sha: 'a3', date: '2026-10-06T12:00:00Z', subject: 'fix: x' }]);
  });
});

describe('the decision-1 readers, against real git', () => {
  const git = (repo, ...args) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const scratch = (name) => {
    const repo = mkdtempSync(join(tmpdir(), `binge-bin1426-${name}-`));
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@example.invalid');
    git(repo, 'config', 'user.name', 'test');
    return repo;
  };
  const write = (repo, rel, body) => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), body, 'utf8');
  };
  const config = (pattern) => JSON.stringify({ reviewGates: [{ name: 'g', patterns: [pattern] }] });

  it('readGitLog gives each commit the files git itself reports for it', () => {
    if (!historyIsAvailable()) return;
    const log = readGitLog();
    expect(log.filter((c) => Array.isArray(c.files) && c.files.length > 0).length).toBeGreaterThan(500);
    for (const c of log.slice(0, 5)) {
      expect(new Set(c.files), c.sha).toEqual(new Set(filesOfCommit(c.sha)));
    }
    const adding = log.find((c) => c.added.length > 0);
    expect(adding, 'no commit in history adds a file — the A status stopped parsing').toBeDefined();
    const addedByGit = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', '--diff-filter=A', adding.sha], {
      cwd: REPO_ROOT, encoding: 'utf8',
    }).split(/\r?\n/).filter(Boolean);
    expect(new Set(adding.added)).toEqual(new Set(addedByGit));
  }, LIVE_WALK_TIMEOUT_MS);

  it('reviewGatesAtCommits reads each commit\'s own config, and null where there is none', () => {
    const repo = scratch('gates');
    try {
      write(repo, 'a.txt', 'x\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'no config yet');
      const none = git(repo, 'rev-parse', 'HEAD').trim();
      write(repo, GATES_CONFIG_REL, config('^first$'));
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'first');
      const first = git(repo, 'rev-parse', 'HEAD').trim();
      write(repo, GATES_CONFIG_REL, config('^second$'));
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'second');
      const second = git(repo, 'rev-parse', 'HEAD').trim();
      const read = reviewGatesAtCommits([second, none, first], repo);
      expect(read.get(first)[0].patterns).toEqual(['^first$']);
      expect(read.get(second)[0].patterns).toEqual(['^second$']);
      expect(read.get(none)).toBeNull();
      expect(reviewGatesAtCommits([], repo).size).toBe(0);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  it('reviewGatesAtCommits on this repo agrees with the config in HEAD', () => {
    if (!historyIsAvailable()) return;
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const atHead = parseReviewGates(execFileSync('git', ['show', `HEAD:${GATES_CONFIG_REL}`], { cwd: REPO_ROOT, encoding: 'utf8' }));
    expect(atHead).not.toBeNull();
    expect(reviewGatesAtCommits([head]).get(head)).toEqual(atHead);
  });

  it('stagedAddedFiles lists an added file and a moved one, never a modified one', () => {
    const repo = scratch('added');
    try {
      write(repo, 'kept.ts', 'a\n');
      write(repo, 'src/app/gammal/page.tsx', 'b\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'seed');
      write(repo, 'kept.ts', 'changed\n');
      write(repo, 'src/app/ny/page.tsx', 'c\n');
      git(repo, 'add', '.');
      mkdirSync(join(repo, 'src', 'app', 'flyttad'), { recursive: true });
      git(repo, 'mv', 'src/app/gammal/page.tsx', 'src/app/flyttad/page.tsx');
      expect(stagedAddedFiles(repo).sort()).toEqual(['src/app/flyttad/page.tsx', 'src/app/ny/page.tsx']);
      expect(stagedFiles(repo).sort(), 'a move must show its old path too').toEqual([
        'kept.ts', 'src/app/flyttad/page.tsx', 'src/app/gammal/page.tsx', 'src/app/ny/page.tsx',
      ]);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  it('stagedReviewGates reads the INDEX, falls back to the working tree and says so, and else gives null', () => {
    const repo = scratch('staged-gates');
    try {
      write(repo, GATES_CONFIG_REL, config('^committed$'));
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'seed');
      write(repo, GATES_CONFIG_REL, config('^staged$'));
      git(repo, 'add', '.');
      write(repo, GATES_CONFIG_REL, config('^worktree$'));
      const staged = stagedReviewGates(repo);
      expect(staged.source).toContain('index');
      expect(staged.gates[0].patterns).toEqual(['^staged$']);
    } finally { rmSync(repo, { recursive: true, force: true }); }

    const plain = mkdtempSync(join(tmpdir(), 'binge-bin1426-nogit-'));
    try {
      write(plain, GATES_CONFIG_REL, config('^worktree$'));
      const fallback = stagedReviewGates(plain);
      expect(fallback.source).toContain('WORKING TREE');
      expect(fallback.gates[0].patterns).toEqual(['^worktree$']);
      rmSync(join(plain, GATES_CONFIG_REL));
      expect(stagedReviewGates(plain).gates).toBeNull();
    } finally { rmSync(plain, { recursive: true, force: true }); }
  });

  it('the real gates give the decision-1 answers the fixture cases assume', () => {
    // Held against the working-tree config, which is what this commit ships.
    const gates = readReviewGates();
    expect(gates).not.toBeNull();
    const owed = (subject, files, added = []) => owesReview({ subject, files, added, gates });
    for (const file of [
      'src/lib/firebase/friends.ts', 'src/contexts/WatchlistContext.tsx', 'src/app/login/page.tsx',
      'src/lib/analytics.ts', 'functions/src/index.ts', 'src/app/admin/reports/page.tsx',
    ]) expect(owed('fix: x', [file]), file).toBe(true);
    for (const file of [
      'src/components/ui/DuotonePoster.tsx', 'src/lib/watchStatus.ts', 'src/app/page.tsx', 'tailwind.config.ts',
    ]) expect(owed('fix: x', [file]), file).toBe(false);
    expect(reviewOwedFor({ subject: 'fix: x', files: ['src/app/page.tsx'], added: ['src/app/page.tsx'], gates }))
      .toContain('new screen');
  });
});
