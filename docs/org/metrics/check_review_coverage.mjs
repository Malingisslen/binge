// check_review_coverage.mjs — fails when a commit that owed a stakeholder-review row
// silently has none. Filed as BIN-917.
//
// TWO MODES, AND THE SECOND ONE EXISTS BECAUSE THE FIRST DRAFT OF THIS HEADER WAS WRONG.
//
// `--message <file>`  — COMMIT TIME. Grades the subject line of the commit being written and
//                       refuses it. Called by lefthook's `commit-msg` hook. This is BIN-917's
//                       criterion 4 as literally stated.
// (no flag)           — HISTORY. Walks every commit and grades the ones already made. This
//                       catches anything that got in before the hook existed, or with the
//                       hook bypassed.
//
// WHICH RUNNER CALLS WHICH is derived, not asserted — a sentence here was the belief that
// produced BIN-1040's first, inert fix (the exemption wired into `main()`, which nothing
// runs, while the assertion that reds the deploy went on charging dependabot):
//
//     grep -rn check_review_coverage .github lefthook.yml package.json
//     git grep -n "findCoverageGaps(" -- docs
//
// The first attempt at this ticket shipped only the second mode and declared the first
// impossible: "there is no commit-time mechanism in this repo — `ls .husky` is empty and
// package.json declares no `husky`/`precommit` hook". Both probes were true. The conclusion
// was false. `lefthook.yml` has been tracked in this repo since 2026-08-08, carries a
// `pre-commit` block with two live commands, `lefthook` is a devDependency, and
// `.git/hooks/pre-commit` is installed. The integration review found it in one grep.
//
// Leaving that on the record on purpose: a search that looks for ONE tool's spelling and
// reports the CAPABILITY absent is exactly the defect this ticket is about, committed inside
// the fix for it. "I could not find X" and "X does not exist" are different sentences.
//
// WHAT THE COMMIT-TIME GATE STILL DOES NOT COVER, stated rather than implied:
//   * It reads the SUBJECT. A commit whose subject names no ticket and is not a code-changing
//     type passes untouched, by design.
//   * `LEFTHOOK=0` skips every hook. That is a deliberate escape hatch in the tool, not a
//     hole this file can close.
//   * The hook only fires where lefthook has installed `.git/hooks/commit-msg`. This repo has
//     no `prepare` script, so adding a hook TYPE requires one `npx lefthook install`. Until
//     that runs on a given machine the config is present and the gate is not armed — the
//     BIN-849 failure shape (a value wired in config and never in the build), which is why it
//     is said here and flagged to the founder rather than assumed.
//   * The history mode remains the backstop for all three.
//
// WHAT IT DOES CHECK
// The sibling asks "does a claim carry its evidence?". This asks the opposite question:
// "is there a claim at all?" A missing row and a clean conscience look identical.
//
// BE EXACT ABOUT WHAT IT WOULD HAVE CAUGHT, because the first draft of this paragraph was
// flattering and wrong. It said the 2026-08-16 sprint "wrote no row whatsoever" and that
// events.jsonl ended with the PREVIOUS run's four rows. Not so: those four rows at
// 13:53:30.297Z are that run's OWN selection-step rows, naming BIN-908/909/880/906 — the very
// tickets in its two commits. check_events.mjs says so three files over.
//
// Replayed properly — each commit graded against the log as its PARENT had it, which is what
// the hook actually sees — the four commits of that week come out:
//
//     049f21b  test(radering): … (BIN-908)          REFUSED — no row yet; they land in this commit
//     851696d  feat(org): … (BIN-880, BIN-906)      PASSES  — rows exist by now
//     dba6683  fix(watchlist): … (BIN-894)          REFUSED — no row of any kind
//     5bd165b  feat(workflow-map): …                REFUSED — subject names no ticket at all
//
// Three of four. The one that passes does so BY DESIGN: its rows are `ran:false` /
// `declined-unattended-shipped`, and this rule accepts a recorded decision — it refuses
// silence, not a decision. Whether an unattended sprint may ship on `ran:false` at all is
// BIN-917's criteria 2 and 3, which live in the selection engine out of tree. Do not read
// this file as having closed that.
//
// It also found two real gaps on its very first run, which is the cleanest evidence for it:
// `634d62e` (BIN-565) and `2e5993a` (BIN-911) had shipped with no row of any kind, though
// both critiques had demonstrably run — the sprint plan at 6d157c5 records their verdicts.
//
// THE RULE. A commit whose subject line is one of the CODE-CHANGING conventional-commit
// types must be traceable to a stakeholder-review row: its subject names at least one
// BIN-id, and every id it names has at least one `review` row in events.jsonl. Such a commit
// with no id in its subject is a violation in its own right — an untraceable change is
// precisely the silence this exists to remove.
//
// THE DENOMINATOR, and how it got its final shape. The first draft covered only `feat` and
// `fix`, on the reasoning that everything else is automation. The outcome verifier killed
// that in one line: `049f21b` — one of the TWO commits in the ticket's own headline, the
// whole reason this file exists — is `test(radering): pinna recent-login-felet … (BIN-908)`,
// so a feat/fix rule would have caught `851696d` and sailed straight past the other half of
// the incident. A checker that misses the case it was written for is worse than none.
//
// So the list is `feat|fix|refactor|perf|test|build|ci`: everything that changes executable
// code or the release path. Measured cost of the widening: ZERO eligible commits added today
// (both variants see the same 2 since the epoch), and 74 rather than 55 over the whole of
// August, all of which are grandfathered anyway.
//
// What is deliberately OUT, and this is a real limit rather than a claim of completeness:
//   * `docs`, `chore`, `style` — 61 of the 135 commits since 2026-08-01. Nightly comment
//     sweeps, janitor runs, lessons-digest folds. Automation that never owed a critique;
//     demanding rows would make the check permanently red, and a permanently red check gets
//     switched off.
//   * `revert` (4 subjects in history), and any commit with NO conventional prefix. Neither
//     matches, so neither is judged, and a revert of reviewed code is a real change this rule
//     will not ask about.
//
//     THE "unprefixed" COUNT DEPENDS ENTIRELY ON THE DEFINITION, so here is the definition
//     with its number rather than a number on its own — a reviewer and I measured this three
//     times and got 129, 142 and 146, all correct for different readings. Over the 948
//     non-merge commits, subjects NOT matching:
//         /^[a-z]+(\([^)]*\))?!?:/                    → 129   (this module's grammar)
//         /^[a-z]+(\([^)]*\))?(\+[a-z]+)*!?:/         → 114   (…allowing `feat(x)+test:`)
//         /^(feat|fix|…|style)(\([^)]*\))?!?:/        → 146   (only the 10 known types)
//         /^[^:\s][^:]*:/                             →  34   (anything before a colon)
//     The 129 are mostly this repo's older `feat(watchlist)+rules:` / `fix(providers)+test:`
//     style, where the suffix after the scope parenthesis breaks the conventional grammar.
//     They are not untraceable commits; they are a spelling this regex does not parse. All
//     of them predate the epoch, so none is judged either way today.
//   * SUBJECT ONLY, never the body. `6d157c5` is a pure documentation correction that names
//     BIN-565 in its body alone; a body-scanning rule would demand a review row for every
//     follow-up comment fix on already-reviewed work.
//
// METHOD, because the method is part of the number. Every figure above comes from ONE
// procedure: `git log --no-merges --format=%cI`, every commit's committer date compared in
// UTC against the boundary. 135 commits since 2026-08-01.
//
// Do NOT cross-check these with `git log --since=…`. It answers a different question — its
// own timezone handling and, for a bare date, the time of day you happen to run it — so it
// will disagree, by a little, unpredictably. Re-derive with the procedure above instead.
//
// That two-sentence warning is all that is left of a paragraph that tried four times to
// explain the discrepancy and got it wrong three times: local-vs-UTC, then out-of-order
// traversal, then an enumeration of "the" possible values that omitted the value it returns
// in this shell. Each was asserted rather than measured and each was caught by the next
// review round. The eventual fix was not a better explanation. It was to stop explaining
// something incidental and name the one procedure the numbers actually come from — which is
// the same lesson as the counts themselves: state the method, not a theory about it.
// An earlier draft of this header asserted a "66" that no window produces, and then, in the
// correction for it, explained the 132 as "git reads --since in LOCAL time" — which is
// backwards, and was caught by the same reviewer on the next pass. A wrong causal story
// inside a paragraph about being careful with numbers. If you re-derive these, say which
// window you used.
//
// ONE MORE THING IT DOES NOT DO. A ticket is "covered" by ANY `review` row bearing its id,
// with no test of recency or scope. A ticket re-opened and re-shipped weeks later is still
// covered by the row written for its first version. Fixing that means deciding what a review
// row's shelf life is, which is a policy question nobody has answered.
//
// AND IT NEVER ASKS WHETHER A ROW IS TRUE. BIN-963 (2026-08-23) is the case study, and it
// is recorded here because the derivation is expensive and nothing else in the tree keeps it.
// That ticket was filed on the reading that three rows — ts 2026-08-22T19:31:26.000Z, for
// BIN-955/928/957, `via:"sprint-parallel"`, `ran:true` — were fabricated, BIN-918’s class.
// Establishing that they are NOT took an artifact this check does not read: `tasks/todo.md`’s
// sprint block carries each critique’s conditions folded in as bracketed acceptance criteria,
// and those counts match the rows’ `must_haves` eight for eight across the whole held batch
// (955:4, 928:2, 957:5, 931:5, 932:5, 922:4, 923:4, 934:4; the rows are in stash 9efa931,
// `git diff 6d3d4a8 9efa931 -- docs/org/metrics/events.jsonl`). Nothing in this file, in its
// sibling, or in the row schema links a row to the artifact that would corroborate it. The
// finding itself is filed as a `correction` row on BIN-963, carrying no `corrects` key,
// because no row in the log is wrong and a keyed correction would RETIRE a true one.
//
// NO GUARD WAS ADDED FOR THE SHAPE THAT LOOKED WRONG, and the reason is the useful part.
// The obvious rule — refuse `via:"sprint-parallel"` together with `ran:true`, on the ground
// that a batch agent cannot spawn the sub-agent a blind critique needs — is wrong about who
// is speaking. The sprint ORCHESTRATOR convenes the critique at Phase 1.4 and writes the row;
// its batch agents cannot, and say exactly that in their own receipts. So a batch note
// reading "NOT convened" does not contradict a row reading `ran:true`: two actors, two
// questions, both answers true. A rule keyed on that pair would refuse precisely the rows
// the engine writes when it does the right thing.
//
// SHALLOW CHECKOUTS. A workflow that omits `fetch-depth` checks out at depth 1 while
// deploy.yml uses `fetch-depth: 0`, so a history walk sees one commit wherever the
// checkout was shallow. In that state this check reports `unverified` and asserts nothing — never a
// silent pass, never a false red. Same three-way honesty as the sibling.
//
// Run:  node docs/org/metrics/check_review_coverage.mjs
// Exit: 0 clean or unverifiable, 1 violations (listed on stderr).

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENTS_PATH, parseEvents, historyIsAvailable, ticketOf } from './check_events.mjs';

/**
 * The epoch. Deliberately NOT check_events.mjs's `RULE_EFFECTIVE_FROM` (2026-08-16), and the
 * cost of each candidate was MEASURED rather than argued — run the grader at three epochs
 * against the same history and log:
 *
 *     2026-08-18 (this)  →  2 eligible,  2 covered,  0 violations, 587 grandfathered
 *     2026-08-16 (reuse) →  8 eligible,  4 covered,  4 violations, 581 grandfathered
 *     2026-08-01         → 74 eligible, 21 covered, 53 violations, 515 grandfathered
 *
 * Reusing the sibling's epoch would ship RED on day one, on four commits written before any
 * such requirement existed. Their absence is not dishonesty, and failing them would be noise
 * — which is how a check gets switched off. Pinned instead to the day this rule ships, so the
 * earliest commits it judges are from that same day. (It does NOT judge the commit that
 * introduces it — that one is not in history yet when the epoch is written. The two it judges
 * on day one are `634d62e` and `2e5993a`, the pair whose missing rows it found and which this
 * batch backfilled. An earlier draft said "the first commit it judges is the one that
 * introduces it", which is tidier and untrue.)
 *
 * The 2026-08-01 row is the honest measure of what this rule does NOT retroactively assert:
 * 53 of the last 74 code-changing commits have no review row. That is the backlog this epoch
 * declines to litigate, not a claim that those commits were reviewed.
 *
 * That row read 5 covered / 69 violations for one round — measured before this same commit
 * taught `ticketsWithAReviewRow` to resolve ids through `ticketOf`. The widened lookup found
 * rows for 16 more commits, so the fix did not only correct a message: it shrank the
 * un-litigated backlog by 16. A number measured against a reader the same commit replaces is
 * the third distinct way this batch produced a stale figure, and the integration review
 * caught all three.
 *
 * The count of commits skipped as older than this is PRINTED on every run, so "clean" can
 * never be mistaken for "every commit in history was reviewed".
 */
export const COVERAGE_EFFECTIVE_FROM = '2026-08-18T00:00:00.000Z';

/**
 * Conventional-commit types that owe a review row: everything that changes executable code
 * or the release path. Anchored, so `docs: describe the feat(x): syntax` does not match, and
 * tolerant of both the optional `(scope)` and the `!` breaking marker — a rule that required
 * `:` straight after the scope would exempt precisely the riskiest commits.
 *
 * `test` is in the list because leaving it out missed `049f21b`, half of the incident this
 * file was filed about. See the header.
 */
const OWES_REVIEW = /^(feat|fix|refactor|perf|test|build|ci)(\([^)]*\))?!?:/;

/**
 * Dependabot's own version bumps, and ONLY those, are exempt from owing a review row.
 *
 * The rule they are exempted from exists to catch MY unreviewed code (BIN-917). A robot's
 * version bump is not that risk: there is no author to critique, and the content is graded
 * by the suite `pr-checks.yml` runs on the pull request. Left un-exempted the rule is worse
 * than useless — merging such a PR turns the deploy red and then blocks UNRELATED code until
 * somebody hand-writes a row for a commit nobody wrote (BIN-1040). Which of the bot's open
 * PRs can actually do that moves with every dependabot run, and only the ones whose subject
 * `OWES_REVIEW` matches at all can: derive it rather than reading a number here.
 *
 * THE EXEMPTION IS TWO SIGNALS AND-ED, NEVER ONE.
 *
 *   1. AUTHORSHIP — the commit is authored by `dependabot[bot]`, established by asking git
 *      itself (`readBotBumpShas`), not by reading the subject line.
 *   2. SUBJECT FORM — the subject carries one of the prefixes DERIVED from
 *      `.github/dependabot.yml`, followed by a `deps…` scope.
 *
 * Signal 2 alone is a governance hole, and #25's blind critique blocked on it: with
 * `commit-message.prefix: "ci"` in that config, `ci(deps): …` is text a human can type, so a
 * subject-only exemption would let a hand-written commit walk out of the rule under a name
 * anyone can spell. Signal 1 alone is too broad in the other direction — it would exempt
 * anything the bot ever authored, not only a version bump.
 *
 * The prefixes are DERIVED rather than listed here so that renaming one in
 * `.github/dependabot.yml` carries the exemption with it instead of silently re-arming the
 * trap under a new name. `dependabotPrefixesFrom` is pinned against the real file by a test.
 *
 * WHERE THIS DELIBERATELY DOES NOT APPLY: `gradeSubject` (the commit-msg hook) grades a
 * commit that does not exist yet and therefore has no author. It exempts nothing, which is
 * the behaviour you want — a human at a keyboard typing `ci(deps): …` still owes their row.
 */
const BOT_AUTHOR = 'dependabot\\[bot\\]';

/**
 * Every `commit-message.prefix` in `.github/dependabot.yml`, in file order.
 *
 * A hand-rolled scan rather than a parse: this repo has no YAML dependency, and adding one
 * to a gate script is a bigger change than the gate itself. The scan is narrow (a `prefix:`
 * key, optionally quoted) and it is PINNED BY A TEST against the real file, so a re-quoting
 * or a new ecosystem block fails loudly here instead of mis-deriving in silence.
 */
export function dependabotPrefixesFrom(yamlText) {
  const PREFIX_LINE = /^[ \t]*prefix:[ \t]*(?:"([^"]*)"|'([^']*)'|([^\s#][^#\r\n]*?))[ \t]*$/gm;
  return [...yamlText.matchAll(PREFIX_LINE)]
    .map((m) => (m[1] ?? m[2] ?? m[3]).trim())
    .filter(Boolean);
}

/** The prefixes the checked-in `.github/dependabot.yml` declares; `[]` when it cannot be read. */
export function readDependabotPrefixes(root = REPO_ROOT) {
  try {
    return dependabotPrefixesFrom(readFileSync(join(root, '.github', 'dependabot.yml'), 'utf8'));
  } catch {
    // No config, no robot, no exemption. Failing OPEN here would be the wrong direction: an
    // unreadable config must never widen who escapes the rule.
    return [];
  }
}

/**
 * The shas git attributes to `dependabot[bot]`. Asked of git rather than inferred, because
 * an authorship claim read off a subject line is not an authorship claim.
 */
export function readBotBumpShas() {
  try {
    const raw = execFileSync(
      'git',
      ['log', '--no-merges', `--author=${BOT_AUTHOR}`, '--format=%H'],
      { cwd: dirname(EVENTS_PATH), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    return new Set(raw.split('\n').map((l) => l.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * True only when BOTH signals agree that this commit is a robot dependency bump.
 *
 * The scope must START with `deps` — that is what dependabot's `include: "scope"` emits, and
 * it is what holds the exemption to version bumps rather than to everything the bot could
 * ever author.
 */
export function isBotDependencyBump(commit, botShas, prefixes) {
  if (!botShas.has(commit.sha)) return false;
  const subject = commit.subject.trim();
  return prefixes.some((prefix) => {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}\\(deps[^)]*\\)!?:`).test(subject);
  });
}

/** Every BIN-id in a commit SUBJECT. Global — one commit may legitimately close several. */
const TICKET_IN_SUBJECT = /\bBIN-\d+\b/g;

/** True when this commit's type is one that owes a stakeholder-review row. */
export function owesReviewRow(subject) {
  return OWES_REVIEW.test(subject.trim());
}

/** The BIN-ids a commit subject names, deduplicated and in order. */
export function ticketsInSubject(subject) {
  return [...new Set(subject.match(TICKET_IN_SUBJECT) ?? [])];
}

/**
 * Every ticket that has at least one `review` row, from the parsed log.
 *
 * THE ID IS RESOLVED BY `check_events.mjs`'s `ticketOf`, NOT by reading `row.ticket` here,
 * and that is a correctness fix rather than tidiness. This function used to read only the
 * `ticket` field and the `tickets` array. Its neighbour has always had a third path — an
 * anchored `BIN-\d+` at the start of the prose — precisely because rows exist that carry no
 * `ticket` field at all, and THE FOUR ROWS FROM THE 2026-08-16 INCIDENT ARE THOSE ROWS.
 *
 * Replayed against the log as it stood at `851696d`, the earlier version could not see
 * BIN-880/906/908/909 and would have refused a commit naming them with the words "has no
 * `review` row in events.jsonl at all" — while four rows for exactly those tickets sat in the
 * file. A guard that misreports the incident it was built for is worse than a guard that
 * misses it, because the message sends the reader to fix the wrong thing.
 *
 * It also made this function's own contract unreachable. The paragraph below says a
 * `ran:false` row WITH a written pull-out reason is an acceptable answer under BIN-917's
 * criterion 4. A row whose id is only in its prose reaches that contract through
 * `check_events.mjs`'s `ticketOf`, not through a `ticket` field. The next unattended sprint
 * that did the right thing would have been refused anyway.
 *
 * A row's `ran` value is still deliberately NOT consulted: the pull-out reason lives on the
 * Linear ticket where no check can read it. What this rule refuses is the absence of any row
 * at all — the silence, not the decision.
 */
export function ticketsWithAReviewRow(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (row.type !== 'review') continue;
    const id = ticketOf(row);
    if (id) seen.add(id);
    // `ticketOf` returns ONE id; a multi-entry `tickets` array is not a key to it, so those
    // are collected here as well. Both readers therefore see strictly more than either alone.
    if (Array.isArray(row.tickets)) for (const t of row.tickets) if (typeof t === 'string') seen.add(t);
  }
  return seen;
}

/**
 * One commit as this check needs it: `{sha, date, subject}`.
 *
 * NUL-delimited on both axes so a subject containing a newline, a tab or a pipe cannot
 * split one commit into two — a subject is free text and this repo's are long.
 */
export function parseGitLog(raw) {
  return raw
    .split('\u0001')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const [sha, date, ...rest] = entry.split('\u0000');
      return { sha, date, subject: rest.join('\u0000') };
    })
    .filter(c => c.sha && c.date);
}

export function readGitLog() {
  const raw = execFileSync(
    'git',
    ['log', '--no-merges', '--format=%H%x00%cI%x00%s%x01'],
    { cwd: dirname(EVENTS_PATH), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  return parseGitLog(raw);
}

/**
 * Grade every commit in the window.
 *
 * @param {{sha:string,date:string,subject:string}[]} commits — newest first, whole history.
 * @param {Set<string>} reviewed — tickets carrying at least one `review` row.
 * @param {{historyAvailable?: boolean, effectiveFrom?: string}} opts
 * @returns {{violations: object[], commitsWalked: number, grandfathered: number,
 *          eligible: number, covered: number, unverified: boolean}}
 *
 * `eligible` is the denominator that matters and `covered` the numerator; `commitsWalked`
 * exists to catch a broken read, which is a different failure from "nothing was eligible".
 * Conflating those two is how a shrink reads as a pass (BIN-838/823/850).
 */
export function findCoverageGaps(commits, reviewed, {
  historyAvailable = true,
  effectiveFrom = COVERAGE_EFFECTIVE_FROM,
  // BIN-1040. Both default to "nothing is exempt", so every caller that does not pass them
  // grades exactly as this file did before the exemption existed.
  botShas = new Set(),
  dependabotPrefixes = [],
} = {}) {
  // A depth-1 checkout can see exactly one commit, so it does not get to answer a question
  // about history at all. Reported, never assumed either way.
  if (!historyAvailable) {
    return { violations: [], commitsWalked: commits.length, grandfathered: 0, eligible: 0, covered: 0, unverified: true };
  }

  const epoch = Date.parse(effectiveFrom);
  const violations = [];
  let grandfathered = 0;
  let eligible = 0;
  let covered = 0;

  for (const commit of commits) {
    if (!owesReviewRow(commit.subject)) continue;
    // BIN-1040, and it sits HERE rather than inside `owesReviewRow` on purpose: the
    // exemption needs the commit's AUTHOR, and the predicate only ever sees a subject. That
    // is also why `gradeSubject` — which grades an unwritten commit — cannot reach it.
    if (isBotDependencyBump(commit, botShas, dependabotPrefixes)) continue;
    if (Date.parse(commit.date) < epoch) { grandfathered++; continue; }

    eligible++;
    const tickets = ticketsInSubject(commit.subject);

    if (tickets.length === 0) {
      violations.push({
        sha: commit.sha.slice(0, 7),
        reason: 'is a feat/fix commit whose subject names no BIN-id, so no review row can '
          + 'ever be keyed to it — an untraceable change is the silence this check exists to remove',
      });
      continue;
    }

    const missing = tickets.filter(t => !reviewed.has(t));
    if (missing.length > 0) {
      violations.push({
        sha: commit.sha.slice(0, 7),
        reason: `names ${missing.join(', ')}, which has no \`review\` row in events.jsonl at all `
          + '— neither a critique that ran nor a recorded decision not to run one',
      });
      continue;
    }
    covered++;
  }

  // THE FLOOR, and it is deliberately on the WALK rather than on `eligible`.
  //
  // #14's blind critique asked for the floor to fire when zero ELIGIBLE commits are found,
  // mirroring `claimsChecked === 0` in the sibling. Implemented literally that would have
  // shipped RED on its first day: the epoch is today, so at the moment this lands there are
  // by construction no commits after it. A check that fails the person introducing it is
  // the "punishes the first person to obey it" failure the sibling's own test file warns
  // about at length. The thing the floor is actually guarding is a BROKEN READ — git
  // missing, wrong cwd, a delimiter that stopped splitting — and that is visible as an
  // empty walk, not an empty eligible set. So the walk carries the hard floor, and
  // `eligible` is disclosed on every run instead (see main()).
  if (commits.length === 0) {
    violations.push({
      sha: null,
      reason: 'walked ZERO commits — git is unavailable, the cwd is wrong, or the log format '
        + 'stopped parsing; this check is not currently protecting anything',
    });
  }

  return { violations, commitsWalked: commits.length, grandfathered, eligible, covered, unverified: false };
}

/**
 * The exemption inputs, built in ONE place because there are TWO callers that grade this
 * repo and they must not drift apart (BIN-1040, found by the integration review).
 *
 * `main()` is one. The other is the live-repo assertion in this module's test file, and
 * THAT is the one that reds the deploy: nothing automated calls `main()` — `lefthook.yml`
 * invokes the `--message` mode — while `deploy.yml` runs `npm test`, which reaches the
 * test. Wiring the exemption into `main()` alone left the defect exactly where it was
 * reported from, under a docblock saying it was fixed. "Check WHERE the rule runs, not only
 * where it was written" is BIN-744/776/917's lesson; this is the same shape.
 *
 * Derive the callers rather than trusting this paragraph:
 *
 *     git grep -n "findCoverageGaps(" -- docs
 */
export function exemptionInputs(historyAvailable) {
  return {
    // No history, no authorship to ask git about — and an empty set exempts nothing, which
    // is the safe direction.
    botShas: historyAvailable ? readBotBumpShas() : new Set(),
    dependabotPrefixes: readDependabotPrefixes(),
  };
}

export function main() {
  const reviewed = ticketsWithAReviewRow(parseEvents(readFileSync(EVENTS_PATH, 'utf8')));
  const historyAvailable = historyIsAvailable();
  const commits = historyAvailable ? readGitLog() : [];
  const result = findCoverageGaps(commits, reviewed, {
    historyAvailable,
    ...exemptionInputs(historyAvailable),
  });

  if (result.unverified) {
    console.log(
      'review coverage: UNVERIFIED — this is a shallow checkout, which can see only the tip, '
      + 'so no claim is made either way here (deploy.yml checks out full history).',
    );
    return 0;
  }

  // "code-changing" rather than "feat/fix": the denominator covers seven types, and a scope
  // line naming two of them would understate what the number counts — in a file whose whole
  // subject is output that says less than it appears to.
  const scope = `${result.commitsWalked} commit(s) walked — ${result.eligible} code-changing `
    + `commit(s) owed a review row since ${COVERAGE_EFFECTIVE_FROM}, ${result.covered} have one, `
    + `${result.grandfathered} skipped as older than that epoch`;

  if (result.violations.length === 0) {
    // The disclosure is not decoration. `eligible: 0` is a perfectly clean run AND a run
    // that checked nothing, and only this line tells them apart.
    console.log(`review coverage: no commit is missing its review row — ${scope}.`);
    return 0;
  }

  console.error(`review coverage: ${result.violations.length} commit(s) with no review row — ${scope}.\n`);
  for (const v of result.violations) {
    console.error(`  ${v.sha ?? '(whole walk)'} — ${v.reason}`);
  }
  console.error('\nEvery feat/fix commit must name its BIN-id in the SUBJECT, and that ticket must');
  console.error('carry a `review` row: `ran:true` for a critique that ran, or `ran:false` with the');
  console.error('pull-out reason written on the ticket. Log one with:');
  console.error("  node docs/org/metrics/log_event.mjs review '{\"ticket\":\"BIN-000\", …}'");
  return 1;
}

/**
 * Grade a commit message that has not been made yet — the COMMIT-TIME half.
 *
 * The history walk above can only judge commits that already exist, which is a check on the
 * PREVIOUS commit. This judges the one being written, from the subject line, before it
 * lands. That is BIN-917's criterion 4 as literally stated, and it is what lefthook's
 * `commit-msg` hook calls.
 *
 * @returns {{ok: true, tickets: string[]} | {ok: false, reason: string}}
 */
export function gradeSubject(subject, reviewed) {
  if (!owesReviewRow(subject)) return { ok: true, tickets: [] };

  const tickets = ticketsInSubject(subject);
  if (tickets.length === 0) {
    return {
      ok: false,
      reason: 'this is a code-changing commit whose subject names no BIN-id, so no review row '
        + 'can ever be keyed to it',
    };
  }

  const missing = tickets.filter((t) => !reviewed.has(t));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `${missing.join(', ')} has no \`review\` row in events.jsonl at all — neither a `
        + 'critique that ran nor a recorded decision not to run one',
    };
  }
  return { ok: true, tickets };
}

/** The repo root, and the path the defaults must compose to. Exported so a test can assert
 *  the composition DIRECTLY, without git. */
export const REPO_ROOT = join(dirname(EVENTS_PATH), '..', '..', '..');
export const DEFAULT_EVENTS_REL = 'docs/org/metrics/events.jsonl';

// The two defaults must compose back to the real file, so it is asserted at import.
//
// An import-time throw is normally the BIN-802 trap (a module that dies on import makes vitest
// report "no tests" and the run can look healthy). Measured here rather than assumed: breaking
// REPO_ROOT gives `Test Files 1 failed (1)` with this message printed, and vitest exits
// non-zero. It fails LOUD, not silent.
//
// One dead end is worth keeping, because it is the obvious thing to try: calling
// `stagedEventsLog(undefined, DEFAULT_EVENTS_REL)` does NOT force the fallback. That relPath is
// the real tracked file, so `git show :<relPath>` succeeds from any cwd inside the repo and the
// git branch wins — the join() such a test exists to exercise is never reached. With the
// assertion disabled it stayed green, measured.
//
// Two absolutes stood here and are STRUCK rather than reworded (2026-08-29, BIN-935): that no
// behavioural test can reach the fallback branch, and that this assertion is the only check
// that would have caught the ENOENT. Both were measured false, and nothing is written in their
// place — derive it instead of trusting a sentence:
//
//   * the fallback branch, under the production defaults and with no fixture override: import
//     this module in a child process whose PATH does not contain `git`, call `stagedEventsLog()`
//     with no arguments, and read `.source`.
//   * what else catches a broken REPO_ROOT: disable this assertion, break the composition, and
//     run `npx vitest run docs/org/metrics/check_review_coverage.test.mjs` — tests in this file
//     fail, not none.
//
// The assertion stays because it fires at import, before any test has chosen what to read.
if (join(REPO_ROOT, DEFAULT_EVENTS_REL) !== EVENTS_PATH) {
  throw new Error(
    `check_review_coverage: REPO_ROOT (${REPO_ROOT}) and the default relPath do not compose to `
    + `EVENTS_PATH (${EVENTS_PATH}) — the worktree fallback would read a path that does not exist.`,
  );
}

/**
 * The log AS IT WILL BE COMMITTED — the index, not the working tree.
 *
 * This distinction is the difference between a gate and a rubber stamp. `shared-plugin.json`
 * lists `events.jsonl` in `delivery.cleanTreeIgnore`, and README records that the sprint
 * engine's own prompt says "Do not commit and do not stage" for the rows it writes. So the
 * concrete, already-documented path is: engine writes a row unstaged → a worktree-reading
 * hook sees it and passes the commit → the row never lands → `deploy.yml` walks the committed
 * history and reds the deploy for a commit the gate just cleared. A false pass at commit time
 * is worse than the false red README already warns about, because nobody looks again.
 *
 * Falls back to the working tree when the path is not in the index at all (a fresh clone
 * mid-rebase, or the file genuinely untracked), and SAYS which it used — an unannounced
 * fallback is how this class of bug hides.
 *
 * EXPORTED, and parameterised on the repo ROOT and a root-relative path, ONLY so a test can
 * drive it. A test that pointed at this repo could never fail: the index and the worktree
 * agree here, so collapsing this whole function to a plain worktree read survives — measured,
 * 39/39 green. Proving the distinction needs a scratch repo where the two genuinely differ,
 * and that needs these two arguments.
 *
 * `repoDir` MUST be the repo root, because the two branches below use it differently: `git
 * show :<relPath>` resolves against the top of the worktree and so tolerates any directory
 * inside the repo, while the fallback joins the two into a real filesystem path and does not.
 * The first version of this parameterisation defaulted to `dirname(EVENTS_PATH)` — the metrics
 * directory — which satisfied the git branch and made the fallback throw ENOENT on
 * `docs/org/metrics/docs/org/metrics/events.jsonl`. It failed CLOSED (the hook dies, the commit
 * is refused) rather than silently, but the docblock claimed a working fallback that could not
 * run, and all 42 tests missed it because every one passes an explicit repoDir that IS a root.
 * That is the seam drifting from production in exactly the axis the parameterisation was
 * reviewed for. `REPO_ROOT` and the import-time assertion above exist so it cannot recur.
 */
export function stagedEventsLog(repoDir = REPO_ROOT, relPath = DEFAULT_EVENTS_REL) {
  try {
    return {
      text: execFileSync('git', ['show', `:${relPath}`], {
        cwd: repoDir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
      }),
      source: 'the index (what this commit will contain)',
    };
  } catch {
    // Any `git show` failure lands here — not in the index, but equally no git, wrong cwd, a
    // blob too large. The announced source therefore says what is TRUE (the read failed and
    // this is the fallback) rather than guessing which of those it was.
    return {
      text: readFileSync(join(repoDir, relPath), 'utf8'),
      source: 'the WORKING TREE — the index could not be read',
    };
  }
}

/** The `--message <file>` entry point. Reads the pending subject and refuses the commit. */
export function mainMessage(messagePath) {
  const subject = (readFileSync(messagePath, 'utf8').split(/\r?\n/)[0] ?? '').trim();
  const log = stagedEventsLog();
  const reviewed = ticketsWithAReviewRow(parseEvents(log.text));
  const verdict = gradeSubject(subject, reviewed);

  if (verdict.ok) {
    if (verdict.tickets.length > 0) {
      console.log(`review coverage: ${verdict.tickets.join(', ')} — review row present in ${log.source}.`);
    }
    return 0;
  }

  console.error(`review coverage: refusing this commit — ${verdict.reason}.\n`);
  console.error(`  subject: ${subject}`);
  console.error(`  read from: ${log.source}\n`);
  console.error('If you just logged the row, STAGE it — events.jsonl is in cleanTreeIgnore and the');
  console.error('sprint engine writes these rows unstaged, so an unstaged row is invisible here and');
  console.error('would red the deploy later instead.\n');
  console.error('A code-changing commit must name its BIN-id in the SUBJECT, and that ticket must');
  console.error('carry a `review` row: `ran:true` for a critique that ran, or `ran:false` with the');
  console.error('pull-out reason written on the ticket. Log one with:');
  console.error("  node docs/org/metrics/log_event.mjs review '{\"ticket\":\"BIN-000\", …}'");
  console.error('\nThis gate is the one BIN-917 asked for. If it is wrong about your commit, fix the');
  console.error('log or the subject — do not reach for LEFTHOOK=0, which disables every gate at once.');
  return 1;
}

// Entry-point guard: without it the CLI runs at import, eats the test runner's argv and
// exits the process, and the symptom is vitest hanging with no output at all (BIN-802).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const flag = process.argv.indexOf('--message');
  process.exit(flag === -1 ? main() : mainMessage(process.argv[flag + 1]));
}
