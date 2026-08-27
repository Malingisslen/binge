// check_review_coverage.test.mjs — BIN-917.
//
// The module under test asks "is there a review row at all?", which is the inverse of its
// sibling's "does this row carry its evidence?". Two properties make that easy to get wrong
// and are pinned hardest here:
//
//   1. THE DENOMINATOR. A rule that demands a row from every commit goes permanently red
//      (61 of the 135 commits since 2026-08-01 UTC are docs/chore/style automation) and a
//      rule that demands one from too few is vacuous. Every branch of `owesReviewRow` is driven
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
} from './check_review_coverage.mjs';
import { EVENTS_PATH, parseEvents, historyIsAvailable } from './check_events.mjs';

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
    // 61 of the 135 commits since 2026-08-01. Nightly comment sweeps, janitor runs,
    // lessons-digest folds. Demanding rows from these is how the check gets switched off.
    for (const subject of [
      'docs(map): re-trace a flow (BIN-6)',
      'chore(janitor): weekly maintenance sweep',
      'style: reformat',
    ]) {
      expect(owesReviewRow(subject), subject).toBe(false);
    }
  });

  it('an unprefixed commit and a revert are OUT OF SCOPE, not silently passed', () => {
    // A stated limit rather than a hidden one: neither matches, so neither is judged, and 0
    // such commits fall in the judged window anyway. The module header carries the historical
    // count against FOUR different definitions of "unprefixed" (129 / 114 / 146 / 34) rather
    // than one bare number, because a reviewer and I measured it three times and got three
    // answers, each right for a different reading. Pinned here so that if someone later
    // decides these SHOULD be judged, this test is where the decision lands.
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
    // — the only writer that produces `ran:false` rows, and it lives out of tree — emits no
    // `ticket` field at all; README counts 42 such rows. So the "a recorded decision is
    // acceptable" contract above was UNREACHABLE for the only party that can exercise it.
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
    // fails the deploy — the "two answers to one question" defect, split across two modes.
    for (const subject of [
      'test(radering): pinna felet (BIN-100)',
      'refactor(push): move a port (BIN-100)',
      'docs(map): re-trace (BIN-100)',
      'chore: sweep',
    ]) {
      const owes = owesReviewRow(subject);
      const graded = gradeSubject(subject, new Set());
      expect(graded.ok, subject).toBe(!owes);
    }
  });
});

describe('mainMessage — the exit code the commit-msg hook acts on', () => {
  // The test reviewer found this branch untested and PROVED it by inverting it: the whole
  // suite stayed green with the hook's verdict backwards. That is survivable on a reporting
  // script and is not survivable here — an inverted commit gate either blocks every clean
  // commit or waves through every violating one, silently, with `npm test` green throughout.
  // Its two siblings (check-public-env, gen-ownership-map) have the same gap; this is the
  // first one on a gate that runs before a commit, so it is the first one worth closing.
  const tmp = (name, body) => {
    const p = join(tmpdir(), `binge-bin917-${name}-${process.pid}.txt`);
    writeFileSync(p, body, 'utf8');
    return p;
  };

  it('exits 0 for a subject whose tickets all have rows', () => {
    // BIN-917 itself: this very batch logged its row, so the live log answers for it.
    const p = tmp('ok', 'fix(org): a thing (BIN-917)\n\nbody\n');
    try {
      expect(mainMessage(p)).toBe(0);
    } finally { rmSync(p, { force: true }); }
  });

  it('exits 1 for a subject naming a ticket with no row', () => {
    const p = tmp('bad', 'fix(org): a thing (BIN-9999999)\n');
    try {
      expect(mainMessage(p)).toBe(1);
    } finally { rmSync(p, { force: true }); }
  });

  it('exits 1 for a code-changing subject naming no ticket', () => {
    const p = tmp('noid', 'feat(x): untraceable\n');
    try {
      expect(mainMessage(p)).toBe(1);
    } finally { rmSync(p, { force: true }); }
  });

  it('exits 0 for a docs subject, and reads only the FIRST line', () => {
    // The body is where a ticket id most often appears in this repo's history, and reading it
    // would make the hook demand rows for follow-up doc fixes. Proven, not assumed: the body
    // below names an unreviewed ticket and the commit is still allowed.
    const p = tmp('docs', 'docs(map): re-trace\n\nRefs BIN-9999999 in the body only.\n');
    try {
      expect(mainMessage(p)).toBe(0);
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
    // Asserted DIRECTLY, without git, because no behavioural call can reach the branch that
    // breaks. The first version of this test called
    // `stagedEventsLog(undefined, DEFAULT_EVENTS_REL)` and its comment claimed that forced the
    // fallback. It did not: that relPath is the real tracked file, so `git show :<relPath>`
    // succeeds from any cwd inside the repo and the git branch wins — the `join()` under test
    // is never evaluated. Proven by the test reviewer: with the module's import-time assertion
    // disabled and REPO_ROOT deliberately broken, all 43 tests stayed green. A test whose
    // comment describes work it does not do is the defect this whole batch is about.
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

describe('the live repo', () => {
  it('every feat/fix commit since the epoch carries a review row', () => {
    // The real log and the real history, the way the sibling's live case works.
    //
    // KNOW WHAT THIS ASSERTION COSTS: `npm test` is a blocking step in deploy.yml,
    // so the next feat/fix commit that ships without anyone logging a review
    // row turns this red and holds the production deploy of unrelated code. Deliberate —
    // that is the silence the check exists to remove — but the remedy is to LOG THE ROW
    // (`ran:true`, or `ran:false` with the pull-out reason written on the ticket), never to
    // weaken the rule to clear it.
    //
    // On its first run this found two: 634d62e (BIN-565) and 2e5993a (BIN-911), whose
    // critiques demonstrably ran — the sprint plan at 6d157c5 records #18/#27 and #19/#5
    // with their verdicts and binding conditions — and were simply never written to the
    // log. Exactly the failure class, found by the check rather than by an incident.
    if (!historyIsAvailable()) return; // depth-1 checkout: the module asserts nothing, nor does this

    const reviewed = ticketsWithAReviewRow(parseEvents(readFileSync(EVENTS_PATH, 'utf8')));
    const result = findCoverageGaps(readGitLog(), reviewed);

    expect(
      result.violations.map(v => `${v.sha ?? '(whole walk)'} — ${v.reason}`),
      'a commit reached main with no stakeholder-review row; log one rather than weakening this',
    ).toEqual([]);
  });

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
