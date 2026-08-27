// Ownership-map ↔ commit-gate symmetry (BIN-880).
//
// Run: npm test (this file is in vitest.config.ts's `include` via
// 'docs/org/**/*.{test,spec}.mjs' — the same glob route.test.mjs relies on).
//
// Why this file exists: TWO lists decide who reviews a change, and widening one has
// never widened the other.
//
//   ADVISING  — docs/org/route.mjs + docs/org/ownership-map.json. Says which roles
//               should critique a change, and whether a sprint may pick it up at all.
//   BLOCKING  — .claude/shared-plugin.json → reviewGates. Refuses the commit.
//
// Every time they drifted apart it was found by a reviewer or an incident, never by a
// test: BIN-830 (route.mjs was code to the router and matched no gate for three days),
// BIN-851 (shared-plugin.json itself reached zero reviewers — the gate could disarm
// itself unwitnessed), BIN-864/873 (gen-ownership-map.mjs, check-public-env.mjs),
// BIN-869 (the reviewers' own instruction files and the hooks). Five reactive widenings;
// this is the check that is supposed to find the sixth gap before an incident does.
//
// Relationship to route.test.mjs's BIN-874 block — they are NOT duplicates:
//   * BIN-874 walks the tooling `.mjs` files under docs/ and scripts/ and compares
//     route.mjs's TOOLING_CODE_FILES against the blocking gate.
//   * THIS file walks every git-TRACKED path (the universe a commit can actually
//     contain) and compares the OWNERSHIP MAP's answer against the blocking gate. That
//     is the half BIN-874 structurally cannot see: deleting `\.(ts|tsx)$` or
//     `^\.github/(workflows|actions)/` from reviewGates left the whole suite green
//     (measured, 837/837, BIN-880 comment 2026-08-14), because neither pattern class
//     falls inside BIN-874's glob.
//
// Three rules, and every input is DERIVED — no hand-copied list of paths anywhere:
//
//   A1  A path the router calls CODE and does not route `skip` over must reach a
//       blocking reviewer. (An owner who is never asked is not a reviewer.) Keyed on the
//       TIER — `tier !== 'skip'` — and deliberately not on the reasonCode (BIN-919).
//
//       It was keyed on reasonCode `owned` OR `high-stakes` for its first two days, and
//       the two reasons for naming both are still true and still worth knowing: the
//       HIGH_STAKES paths never answer `owned`, because the tier branch that names them
//       wins first, so a rule keyed on `owned` alone is structurally blind to
//       firestore.rules, firestore.indexes.json, src/lib/firebase/{groups,userData,
//       dataExport}.ts, functions/src/submitReport/ and src/contexts/AuthContext.tsx —
//       the repo's most sensitive files, the ones a gate deletion hurts most, and ones
//       A2 cannot cover either (none is owned by #25) nor B (they route `top`, never
//       `skip`).
//
//       What that enumeration still missed is a THIRD reasonCode: `unmapped-code`, code
//       that no role owns. Per BIN-788 that is a real review obligation seated on the #14
//       fallback, not a `skip` — so a rule that listed two of the three answers was blind
//       to a whole class, and `package.json` sat in it, reaching zero blocking reviewers
//       while the router demanded a critique (BIN-919). Keying on the tier asks the
//       question the rule actually means — "did the router decline to clear this path?" —
//       instead of re-deriving it from an enumeration that has now been wrong twice.
//       Measured before the change: of 859 code paths, 556 `owned`, 294 `unmapped-code`,
//       9 `high-stakes`; 293 of the 294 already reached a gate, so the rekey surfaced
//       exactly one new offender — the file the ticket was about.
//
//       SAY THE NEXT PART PRECISELY, because the obvious summary of this commit is wrong.
//       The rekey is NOT what closes `package.json`. That file also gained an owner in the
//       same commit, which makes it answer `owned`, which the OLD keying already saw —
//       probed by deleting the new gate pattern and re-grading: both keyings then report
//       it. The ownership half alone would have closed that one file. What the rekey buys
//       is the CLASS, and that was probed too: strip the tooling alternation from the
//       integration gate and the old keying reports 2 offenders (route.mjs and
//       gen-ownership-map.mjs, the two that happen to be owned) while this rule reports 7
//       — adding check_events.mjs, log_event.mjs, check_review_coverage.mjs,
//       check-public-env.mjs and check-workflow-map.mjs, every one of them code nobody
//       owns. FIVE files' worth of blindness, on the exact gate whose five previous
//       widenings were each found by a human. That is the measurement that justifies the
//       rekey; "it catches package.json" is not. (It read 6/four for one round — measured
//       before this same commit added check_review_coverage.mjs, which the integration
//       review caught. The argument gets stronger, which is why it is worth being right.)
//
//       The cost is real and forward-looking: a NEW root-level config file (a .nvmrc, a
//       renovate.json) that nobody owns and no gate matches now fails `npm test`, and
//       therefore the deploy, until it gets one or the other. That brake is the point.
//   A2  A path owned by role #25 Engineering Manager / Release Manager must reach a
//       blocking reviewer, code or prose. #25 owns the process and the quality gates
//       BY DEFINITION, so anything in that role's patterns decides how the repo is
//       reviewed or released — CLAUDE.md (the routing instructions every agent reads)
//       and .github/dependabot.yml were the two of its fifteen paths that reached no
//       gate at all when this was written.
//   B   A path the blocking gate stops must not route `skip`. A commit held for a
//       review the router says is unnecessary is the same drift seen from the other
//       side, and it is how a gate ends up protecting a path nobody owns.
//
// Deliberately NOT a plain biconditional over every tracked path. Ownership of PROSE is
// advisory on purpose — docs/RUNBOOK.md, docs/SLO.md, docs/moderation.md and the ADRs
// have owning roles precisely so a plan gets their critique, and gating a runbook edit
// on a commit reviewer is the broad reading Malin refused twice (2026-08-08, alternative
// (a); again in BIN-830/851/864/869). #25 is the one role whose prose IS review
// machinery, which is why A2 names that role rather than a list of files.
//
// Known blind spots, stated rather than implied:
//
//   1. CLOSED 2026-08-18 (BIN-919). It used to read: "a path with NO owning role and no
//      gate is invisible to all three rules — `package.json` is the live example (the
//      router calls it code, nothing owns it, no gate matches it). Closing that is an
//      ownership decision, not a test." Both halves were fixed, in one commit rather than
//      one-or-the-other: A1 now keys on `tier !== 'skip'`, which makes the whole
//      `unmapped-code` class visible to the check, AND `package.json` itself got an owner
//      (#25, docs/role-responsibilities.md) and a gate (binge-integration-reviewer).
//      Fixing only the file would have left the CLASS invisible and the next such path
//      just as silent — the old note's "an ownership decision, not a test" was half
//      wrong, and the half it got wrong is the half that generalises.
//
//      What remains true is narrower, and is A1's stated limit rather than a blind spot:
//      a path no role owns still satisfies A1 as long as SOME gate stops it. EVERY
//      unowned code path is in exactly that position on the tree this ships with —
//      reviewed, but unattributed. That is BIN-871's subject, not this file's. Re-derive
//      the count from the tree rather than reading one here: a present-tense count
//      written inside a commit that moves it is stale before the commit lands, and this
//      sentence has already carried two wrong ones.
//   2. The rules count reviewers, they do not identify them. `blockingGates` returning a
//      non-empty list satisfies A1/A2 no matter WHICH agent is in it, so "firestore.rules
//      lost its SECURITY reviewer but still matches some other gate" is not a shape this
//      file can see — only "reached ZERO blocking reviewers" is. Deleting `^functions/`
//      or `^src/lib/firebase/` from the security gate stays green here, because every
//      `.ts` under them is also matched by the code and integration gates. Pinning which
//      agent must see which surface means a per-agent expectation (a fourth rule), and
//      that is a real list of paths — the hand-copied thing this file exists to avoid —
//      so it is deliberately not attempted here.
//   3. `blockingGates()` is a MODEL of the blocking hook, not the hook. It re-implements
//      the hook's matching by hand — `exact` ∪ `patterns`, minus `exclude` — inside the
//      one file whose entire purpose is that two lists must not drift apart. It is
//      faithful today. It is not pinned to anything, so a change to the hook's semantics
//      leaves this file certifying symmetry against a copy that no longer describes what
//      blocks a commit. Three shapes would do it silently: an `exclude` that also applies
//      to `exact`, anchoring, and case-sensitivity.
//
//      One of those three is partly covered — the case named "the gate-matching helper
//      subtracts excludes, like the real hook does" pins exclude-over-patterns. The
//      `exact`+`exclude` combination is not exercised by anything, including the live
//      config; derive that rather than trusting this sentence:
//        node -e "const g=require('./.claude/shared-plugin.json').reviewGates; console.log(g.filter(x=>(x.exact||[]).length).length)"
//      A zero there means the combination is latent, not live — a real gap, but one no
//      current commit can walk into.
//
//      Having this file EXECUTE the real hook was considered and rejected. The hook lives
//      in `C:/claude-plugins/plugins/workflow-guards/scripts/`, a sibling repo that is not
//      guaranteed checked out in CI. A test that requires it fails on a clean runner; a
//      test that skips when it is absent reports a pass in exactly the environment that
//      gates the deploy, which is the shrink-reads-as-a-pass class (BIN-838/823/850) this
//      whole file exists to stop. So this stays a stated limit rather than a mechanism —
//      and it is a limit, not a check: nothing here compares the two. (BIN-926)
//
//      `blockingGates()` is not the only copy. `gateMatches()` in `docs/org/route.test.mjs`
//      models the same hook the same way and carries the same exposure, so a change to the
//      hook's semantics has two places to be reflected, not one. Fixing either without the
//      other is how the two lists this file watches would start disagreeing about
//      themselves.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { route, isCodePath } from './route.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const posix = (p) => p.replace(/\\/g, '/');

// The role that owns the quality gates themselves (docs/role-responsibilities.md §25).
const GATEKEEPER_ROLE = 25;

const CONFIG = JSON.parse(readFileSync(join(REPO_ROOT, '.claude', 'shared-plugin.json'), 'utf8'));
const GATES = CONFIG.reviewGates;

// Which blocking reviewers does the real commit gate demand for this path? Mirrors
// require-review-before-commit.mjs: `exact` OR a pattern match, then MINUS `exclude`.
function blockingGates(file) {
  return GATES.filter((gate) => {
    const hit =
      (gate.exact || []).includes(file) || (gate.patterns || []).some((p) => new RegExp(p).test(file));
    return hit && !(gate.exclude || []).some((p) => new RegExp(p).test(file));
  }).map((gate) => gate.agent);
}

// The universe is what a COMMIT can contain: git-tracked files. Not a filesystem walk —
// node_modules/.next/out would swamp it, and an untracked file cannot be staged.
const TRACKED = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map(posix);

// One route() per path (~600 ms for ~1000 paths), computed once for all three rules.
const VERDICTS = TRACKED.map((path) => {
  const r = route([path]);
  return {
    path,
    tier: r.tier,
    reasonCode: r.reasonCode,
    ownedByGatekeeper: r.roles.some((role) => role.num === GATEKEEPER_ROLE),
    gates: blockingGates(path),
  };
});

// Keyed on the TIER, not on an enumeration of reasonCodes (BIN-919 — the header explains
// why at length). `tier !== 'skip'` is the question the rule means: the router looked at
// this path and declined to clear it. Every reasonCode that answers anything other than
// `skip` is therefore in scope by construction — `owned`, `high-stakes` AND `unmapped-code`
// — and a fourth one invented tomorrow is in scope the day it is added, without anyone
// remembering to extend a list here. The two enumerations this replaced were each wrong
// once: `owned` alone was blind to the seven high-stakes paths (route() decides the tier
// top-down, so firestore.rules answers `high-stakes` and NEVER `owned` however many roles
// own it — measured: with `^firestore\.rules$` removed from the security gate, that file
// reached zero blocking reviewers and all three rules still reported perfect symmetry),
// and `owned`+`high-stakes` was blind to `unmapped-code`, where package.json sat.
// A NAMED FUNCTION rather than an inline filter, and that is load-bearing rather than
// tidiness: the regression guard for the rekey has to run the SAME code the rule runs. The
// first version of that guard declared its own local copy of the predicate and asserted
// against that — so reverting the rule here left the guard perfectly green while its
// comment claimed it would go red. Measured by mutation: the reverted rule passed 9/9. A
// guard that cannot see the thing it guards is worse than none, because it reads as
// coverage. Anything testing A1 must call THIS.
export function a1Offenders(verdicts) {
  return verdicts.filter((v) => isCodePath(v.path) && v.tier !== 'skip' && v.gates.length === 0);
}

const advisedCodeWithoutGate = a1Offenders(VERDICTS);
const gatekeeperPathsWithoutGate = VERDICTS.filter((v) => v.ownedByGatekeeper && v.gates.length === 0);
const gatedButRoutedSkip = VERDICTS.filter((v) => v.gates.length > 0 && v.tier === 'skip');

const isAsymmetric = (path) =>
  [...advisedCodeWithoutGate, ...gatekeeperPathsWithoutGate, ...gatedButRoutedSkip].some(
    (v) => v.path === path,
  );

// Paths where the two lists deliberately disagree. A LIST WITH A REASON EACH, never a
// silence — and the rot test below fails the moment an entry stops being needed, so a
// closed hole cannot leave a stale excuse behind (the shape route.test.mjs's
// NOT_REVIEW_MACHINERY uses, same contract).
const ACCEPTED_ASYMMETRIES = {
  'functions/.gitignore':
    'The security gate matches all of `^functions/` by prefix — deliberately broader than any file list, because that is where Cloud Functions code lives and an enumeration would go stale. A .gitignore inside it is caught by that breadth and routes `skip` (not a code extension, no owner). Narrowing the security gate to buy symmetry on an ignore-file would trade a real guard for a cosmetic one.',
  'scripts/scripts-self-tests-present.test.mjs':
    'The floor asserting every script under scripts/ carries a self-test (BIN-850). The test gate matches every `\\.test\\.mjs$` in the repo, which is the point of that pattern; the router leaves ordinary `scripts/` tooling as `skip` because pulling all of scripts/ into the code roots is the broad widening Malin refused (2026-08-08, alternative (a)). Same file, same reasoning, as route.test.mjs\'s NOT_REVIEW_MACHINERY entry.',
};

describe('the gate config has the shape this check reads (BIN-880)', () => {
  it('every gate is an object with an agent, a marker and a pattern list', () => {
    // Named, and BEFORE the rules below: deleting a whole gate object (not just one of
    // its patterns) otherwise surfaces as a property read on `undefined` inside every
    // case at once — loud, but pointing at this file instead of at the config that
    // changed. Same finding as BIN-906 #4 against route.test.mjs.
    expect(Array.isArray(GATES)).toBe(true);
    expect(GATES.length).toBeGreaterThanOrEqual(4);
    for (const gate of GATES) {
      expect(typeof gate.agent, `a reviewGates entry has no agent: ${JSON.stringify(gate)}`).toBe('string');
      expect(typeof gate.marker, `${gate.agent}: no marker file`).toBe('string');
      expect(
        (gate.patterns || []).length + (gate.exact || []).length,
        `${gate.agent}: gate matches nothing at all — it can never block`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('an advising owner without a blocking gate (BIN-880)', () => {
  it('A1: every CODE path the router does not clear reaches a blocking reviewer', () => {
    // The name says "does not clear", not "owned": since BIN-919 this rule is keyed on the
    // TIER, so an offender may well have no owning role at all. The old name and the old
    // failure message both said "owned", which would have been simply false for the
    // `unmapped-code` offenders the rekey exists to surface — telling whoever hits it to go
    // looking for an owner that was never there.
    const offenders = advisedCodeWithoutGate
      .filter((v) => !(v.path in ACCEPTED_ASYMMETRIES))
      .map((v) => `${v.path} (router: ${v.tier}/${v.reasonCode}, blocking gate: none)`);

    expect(
      offenders,
      'code the router will not clear that no commit gate stops. Three remedies, and the '
      + 'right one depends on the reasonCode above: widen .claude/shared-plugin.json → '
      + 'reviewGates; or give the path an owner in docs/role-responsibilities.md and '
      + 'regenerate docs/org/ownership-map.json (which is the fix when the reasonCode is '
      + '`unmapped-code`, though note it changes WHO advises, not whether a commit is '
      + `stopped); or add a reasoned entry to ACCEPTED_ASYMMETRIES:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('A2: every path owned by the role that owns the gates reaches a blocking reviewer', () => {
    // CLAUDE.md is why this rule is separate from A1: it is prose, so `isCodePath` is
    // false and A1 never looks at it — and it is the paragraph telling every agent how
    // to route a change and when to convene a panel. BIN-869 edited exactly that
    // paragraph and no gate fired.
    const offenders = gatekeeperPathsWithoutGate
      .filter((v) => !(v.path in ACCEPTED_ASYMMETRIES))
      .map((v) => `${v.path} (owned by #${GATEKEEPER_ROLE}, blocking gate: none)`);

    expect(
      offenders,
      `review/release machinery that no commit gate stops — widen .claude/shared-plugin.json → reviewGates, or add a reasoned entry to ACCEPTED_ASYMMETRIES:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('B: nothing the gate blocks routes `skip` on the advising side', () => {
    const offenders = gatedButRoutedSkip
      .filter((v) => !(v.path in ACCEPTED_ASYMMETRIES))
      .map((v) => `${v.path} (blocking gate: ${v.gates.join(', ')}, router: skip/${v.reasonCode})`);

    expect(
      offenders,
      `a commit is held for a review the router calls unnecessary — give the path an owner (docs/role-responsibilities.md + regenerate docs/org/ownership-map.json) or add a reasoned entry to ACCEPTED_ASYMMETRIES:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('the exceptions and the inputs cannot rot quietly (BIN-880)', () => {
  it('every accepted asymmetry carries a reason and is still asymmetric', () => {
    for (const [path, reason] of Object.entries(ACCEPTED_ASYMMETRIES)) {
      expect(reason.length, `${path}: an exception needs a reason, not a placeholder`).toBeGreaterThan(120);
      expect(TRACKED, `${path} is exempted but the repo no longer tracks it — delete the entry`).toContain(
        path,
      );
      expect(
        isAsymmetric(path),
        `${path} is exempted but the two lists now agree about it — its exception is spent, delete the entry`,
      ).toBe(true);
    }
  });

  it('the derived inputs have not silently emptied', () => {
    // Every rule above is a filter over these. An empty TRACKED (git missing, wrong cwd,
    // a `-z` that stopped splitting) would make all three assert `[] === []` and report
    // total symmetry — the shrink-reads-as-a-pass class this whole family exists to stop
    // (BIN-838/823/850). Floors, not equalities: the repo is expected to grow.
    //
    // TWO OF THESE WERE RAISED 2026-08-18, and the reason is worth keeping: #25's blind
    // critique of the commit that introduced them measured each floor against its live
    // value and found `tier !== 'skip'` at 400 against an actual 883, and `gates.length >
    // 0` at 400 against an actual 875 — floors at 45% and 46%, which would sit still while
    // a regression silently halved the router's output. That is BIN-926's subject and the
    // BIN-838/823/850 family: a floor far below the real value is decoration. Both are now
    // 700. The other three were already tight and are unchanged.
    //
    // No live values are enumerated here. A measurement taken mid-commit describes a tree
    // that no longer exists by the end of it, so read the live numbers off the tree with
    // the same procedure the assertions below use.
    //
    // Floors, not equalities: the repo is expected to grow, and a floor that has to be
    // edited on every commit gets edited without being thought about.
    expect(TRACKED.length).toBeGreaterThanOrEqual(800);
    expect(VERDICTS.filter((v) => v.tier !== 'skip').length).toBeGreaterThanOrEqual(700);
    expect(VERDICTS.filter((v) => v.gates.length > 0).length).toBeGreaterThanOrEqual(700);
    expect(VERDICTS.filter((v) => v.ownedByGatekeeper).length).toBeGreaterThanOrEqual(15);
    // A1 is keyed on the tier, so its scope is every non-skip code path — but the class it
    // was widened to SEE is `unmapped-code`, and nothing above would notice if route.mjs
    // stopped emitting that answer. Then A1 would quietly narrow back to the pre-BIN-919
    // rule while every assertion in this file stayed green: the rekey undone by a change
    // somewhere else, with no test to say so.
    //
    // Set at 230, deliberately in the same band as its neighbours. It was 100 for one
    // round — looser than the two floors this very commit raises for being decoration.
    // A floor written to a rule the same commit calls decoration is not a floor, and the
    // outcome verifier caught it.
    expect(
      VERDICTS.filter((v) => isCodePath(v.path) && v.reasonCode === 'unmapped-code').length,
      'the `unmapped-code` class has collapsed — A1 has silently narrowed back to what it was before BIN-919',
    ).toBeGreaterThanOrEqual(230);
    // A1's high-stakes half specifically: if route.mjs's HIGH_STAKES list were emptied,
    // no verdict would carry this reasonCode and that half of A1 would pass vacuously
    // while looking identical to a green run. Floor, not an equality — the list is
    // expected to grow, and directory entries (functions/src/submitReport/) match more
    // than one tracked file.
    expect(VERDICTS.filter((v) => v.reasonCode === 'high-stakes').length).toBeGreaterThanOrEqual(7);
    // …and the universe really is the tracked tree, not a subdirectory of it.
    expect(TRACKED).toContain('CLAUDE.md');
    expect(TRACKED).toContain('.claude/shared-plugin.json');
    expect(TRACKED).toContain('firestore.rules');
  });

  it('A1 is keyed on the tier, so it catches an UNOWNED code path with no gate', () => {
    // The regression guard for BIN-919's rekey. It runs `a1Offenders` — the real rule, not
    // a restatement of it — because the first version of this test declared a local copy of
    // the predicate and was therefore vacuous: reverting the rule left it green while its
    // own comment promised it would go red (measured; 9/9 passed with the rule reverted).
    //
    // The obvious guard would not have worked either: `package.json` gained an OWNER in the
    // same commit, so a test pinning that one file passes under the superseded keying too
    // and proves nothing. What actually separates the two rules is a path that is CODE, is
    // not `skip`, and is owned by NOBODY. The synthetic verdicts below use real repo paths,
    // because `isCodePath` is part of the rule and an invented filename would fail it for
    // the wrong reason.
    const unownedUngatedCode = {
      path: 'docs/org/route.mjs', tier: 'medium', reasonCode: 'unmapped-code', gates: [],
    };
    expect(
      a1Offenders([unownedUngatedCode]),
      'A1 no longer sees code that no role owns — the BIN-919 rekey has been reverted, and this is the whole class it was widened to catch',
    ).toHaveLength(1);

    // …and it must still catch everything the superseded keying did, or the rekey traded
    // one blind spot for another. Both `owned` and `high-stakes` route non-skip, so this
    // holds by construction — pinned anyway, because "by construction" is an argument and a
    // test is what replaces an argument.
    expect(a1Offenders([
      { path: 'docs/org/route.mjs', tier: 'medium', reasonCode: 'owned', gates: [] },
      { path: 'firestore.rules', tier: 'top', reasonCode: 'high-stakes', gates: [] },
    ]), 'A1 stopped seeing owned or high-stakes code').toHaveLength(2);

    // The negative half, so the rule is not simply "everything is an offender": a gated
    // path and a `skip` path are both fine, and a non-code path is out of A1's scope.
    expect(a1Offenders([
      { path: 'docs/org/route.mjs', tier: 'medium', reasonCode: 'owned', gates: ['binge-integration-reviewer'] },
      { path: 'docs/org/route.mjs', tier: 'skip', reasonCode: 'doc-only', gates: [] },
      { path: 'docs/RUNBOOK.md', tier: 'medium', reasonCode: 'owned', gates: [] },
    ]), 'A1 is flagging paths it should not').toEqual([]);
  });

  it('the gate-matching helper subtracts excludes, like the real hook does', () => {
    // `blockingGates` is the only thing standing between this file and the real gate,
    // so its two halves are pinned directly: a match, and a match that an `exclude`
    // takes back. The test gate matches `\.test\.(ts|tsx)$` repo-wide; the code gate
    // matches `^src/.*\.(ts|tsx)$` but excludes exactly those test files. A helper that
    // forgot `exclude` would seat binge-code-reviewer here and every rule above would
    // silently loosen (it would start demanding gates that do not exist).
    expect(blockingGates('src/lib/watchStatus.ts')).toContain('binge-code-reviewer');
    expect(blockingGates('src/lib/watchStatus.test.ts')).toContain('binge-test-reviewer');
    expect(blockingGates('src/lib/watchStatus.test.ts')).not.toContain('binge-code-reviewer');
  });
});

describe("the router's own golden cases are wired to something that runs (BIN-880)", () => {
  it('node docs/org/route.mjs --selftest exits 0', () => {
    // `--selftest` is advertised in route.mjs's usage block ("exit non-zero on fail") and
    // was invoked by NOTHING — not package.json, not deploy.yml, not a hook.
    // A documented command nobody runs teaches the next reader to ignore it, and route.mjs
    // line 418 pointed at this ticket to fix that. `npm test` gates deploy.yml, so running
    // it here is the wiring: a red golden case now fails the deploy instead of a terminal
    // nobody opens.
    expect(() =>
      execFileSync('node', [join('docs', 'org', 'route.mjs'), '--selftest'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
