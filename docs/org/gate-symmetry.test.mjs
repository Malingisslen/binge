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
//       blocking reviewer. (An owner who is never asked is not a reviewer.) That is
//       reasonCode `owned` AND `high-stakes`: the seven HIGH_STAKES paths never answer
//       `owned` — the tier branch that names them wins first — so a rule keyed on
//       `owned` alone is structurally blind to firestore.rules, firestore.indexes.json,
//       src/lib/firebase/{groups,userData,dataExport}.ts, functions/src/submitReport/
//       and src/contexts/AuthContext.tsx. Those are the repo's most sensitive files and
//       the ones a gate deletion hurts most; A2 cannot cover them either (none is owned
//       by #25) and neither can B (they route `top`, never `skip`).
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
//   1. A path with NO owning role and no gate is invisible to all three rules —
//      `package.json` is the live example (the router calls it code, nothing owns it, no
//      gate matches it). Closing that is an ownership decision (name an owner in
//      docs/role-responsibilities.md and regenerate the map), not a test.
//   2. The rules count reviewers, they do not identify them. `blockingGates` returning a
//      non-empty list satisfies A1/A2 no matter WHICH agent is in it, so "firestore.rules
//      lost its SECURITY reviewer but still matches some other gate" is not a shape this
//      file can see — only "reached ZERO blocking reviewers" is. Deleting `^functions/`
//      or `^src/lib/firebase/` from the security gate stays green here, because every
//      `.ts` under them is also matched by the code and integration gates. Pinning which
//      agent must see which surface means a per-agent expectation (a fourth rule), and
//      that is a real list of paths — the hand-copied thing this file exists to avoid —
//      so it is deliberately not attempted here.

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

// `high-stakes` as well as `owned`: route() decides the tier top-down, so a HIGH_STAKES
// path answers `high-stakes` and NEVER `owned`, however many roles own it (firestore.rules
// is owned by #4/#6/#27 and still reports `high-stakes`). Keyed on `owned` alone this rule
// could not see the seven paths it exists to protect — measured: with `^firestore\.rules$`
// removed from the security gate, that file reached zero blocking reviewers and all three
// rules still reported perfect symmetry.
const advisedCodeWithoutGate = VERDICTS.filter(
  (v) =>
    isCodePath(v.path) &&
    (v.reasonCode === 'owned' || v.reasonCode === 'high-stakes') &&
    v.gates.length === 0,
);
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
  '.github/workflows/secret-scan.yml':
    'The blocking gate covers `^\\.github/(workflows|actions)/` as a directory prefix on purpose (BIN-666/667: gating only the files that exist today exempts whatever is extracted tomorrow), while the ownership map names three of the four workflows — deploy, ci, preview. Closing this one means naming an owner for secret-scan.yml in docs/role-responsibilities.md and regenerating the map, which is an ownership decision for §8/§20 rather than a gate edit.',
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
  it('A1: every owned CODE path reaches a blocking reviewer', () => {
    const offenders = advisedCodeWithoutGate
      .filter((v) => !(v.path in ACCEPTED_ASYMMETRIES))
      .map((v) => `${v.path} (router: ${v.tier}/${v.reasonCode}, blocking gate: none)`);

    expect(
      offenders,
      `code with an owning role that no commit gate stops — widen .claude/shared-plugin.json → reviewGates, or add a reasoned entry to ACCEPTED_ASYMMETRIES:\n${offenders.join('\n')}`,
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
    expect(TRACKED.length).toBeGreaterThanOrEqual(800);
    expect(VERDICTS.filter((v) => v.tier !== 'skip').length).toBeGreaterThanOrEqual(400);
    expect(VERDICTS.filter((v) => v.gates.length > 0).length).toBeGreaterThanOrEqual(400);
    expect(VERDICTS.filter((v) => v.ownedByGatekeeper).length).toBeGreaterThanOrEqual(15);
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
    // was invoked by NOTHING — not package.json, not ci.yml, not deploy.yml, not a hook.
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
