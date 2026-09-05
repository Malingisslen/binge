// route.mjs — blast-radius router for Binge's virtual role-org.
//
// Given a set of repo-relative file paths (a plan's blast radius, a ticket's touched
// files, or `git diff --name-only`), resolve:
//   - which role(s) own those paths (via the committed docs/org/ownership-map.json), and
//   - the review TIER (top / medium / skip) per the constitution in
//     docs/org/world-watch/DESIGN.md §1.3.
//
// This is the SINGLE SOURCE OF TRUTH for the tier + panel. /linear stamps the owning
// roles into new tickets, /sprint-execute reads the tier to decide whether to convene a
// stakeholder panel before building, and /stakeholder-review uses it to scope its panel —
// so none of them carry a private, drifting copy of the risk logic.
//
// It is deterministic string-matching — NO model call, NO network — so it runs free and
// fits the $0/interactive cost model (DESIGN §0).
//
// Usage:
//   node docs/org/route.mjs <path> [<path> ...]      # paths as args
//   git diff --name-only | node docs/org/route.mjs   # paths on stdin (newline-separated)
//   node docs/org/route.mjs --md <path> ...          # print a ready "## Stakeholders" block
//   node docs/org/route.mjs --selftest               # run golden assertions, exit non-zero on fail
//
// Output (default): one JSON object on stdout —
//   { tier, reason, reasonCode, highStakes: [...], panel: [roleNum...],
//     roles: [{num,title,slug,matched:[...],inherited:[...]}], dropped: [...],
//     unmapped: [...], unmappedCode: [...], unownedCode: [...] }
//   `unmappedCode` = code no pattern matched; `unownedCode` = code no *code* role reviews
//   (that plus code owned only by the Technical Writer). The tier reads `unownedCode`.
//   tier "skip" → panel []. Exit code is always 0 for a successful route (skip is a valid
//   outcome, not an error); 1 only on a usage/IO error or a failed --selftest.
//
// BIN-788 — two things this router used to get wrong, both of which made a risky change
// look cleared:
//   1. The ownership map enumerates FILES. A brand-new file in a
//      directory with ten owned siblings matched nothing. Resolution is now
//      DIRECTORY-based for code paths: a role that owns a file in a directory owns that
//      directory's other code files too (reported per role in `inherited`).
//   2. "No owning role" and "deliberately trivial" returned the SAME answer (`skip`), so
//      an unmapped path read as a cleared one. An unmapped CODE path is now `medium`
//      (reasonCode `unmapped-code`, fallback seat #14 Software Architect) and is listed
//      in `unownedCode` — a code path with no owning role — while `unmappedCode` carries
//      code paths that matched no role at all. (BIN-834: this comment named the wrong
//      field. Run against the shipped router for `docs/org/route.mjs` before it got an
//      owner, `unmappedCode` was `[]` and the path sat in `unownedCode`.) Only genuinely
//      non-code paths (docs, plans, scratch) still route `skip` (reasonCode `doc-only` /
//      `no-code-paths`). Read `reasonCode`, not the prose in `reason`, when a tool needs
//      to tell those apart.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mapPath = join(repoRoot, 'docs', 'org', 'ownership-map.json');

// ── Constitution constants (DESIGN.md §1.3) — keep in sync with that doc ──────────────

// High-stakes paths: ANY hit forces the full panel (TOP). This is the exact list from
// DESIGN §1.3 / the /stakeholder-review skill — security rules, GDPR data, moderation,
// auth. Path-based proxies only; a *semantic* high-stakes change (deletes/migrates user
// data) that touches none of these is a manual --force-top override by the caller.
const HIGH_STAKES = [
  'firestore.rules',
  'firestore.indexes.json',
  'src/lib/firebase/groups.ts',
  'src/lib/firebase/userData.ts',
  'src/lib/firebase/dataExport.ts',
  'functions/src/submitReport/',
  'src/contexts/AuthContext.tsx',
];

// Roles that own a high-stakes concern — seated first when capping a TOP panel.
const HIGH_STAKES_ROLES = new Set([4, 5, 6, 27]); // Security, Legal, DPO, DBA

// Technical Writer: a doc-only change owned ONLY by #21 is a SKIP, and #21 is never the
// sole MEDIUM reviewer for a code change.
const TECH_WRITER = 21;

// TOP panels are capped to keep the (expensive) blind panel right-sized (DESIGN §2.6).
const PANEL_CAP = 5;

// Software Architect — the seat for a CODE path no role owns (BIN-788). Someone reviews
// the unknown; nobody reviewing it is what this ticket was filed about.
const UNMAPPED_FALLBACK_ROLE = 14;

// What counts as CODE for the unmapped/trivial split. Deliberately the same surface the
// repo's own commit gates call production code (.claude/shared-plugin.json →
// productionGlobs + reviewGates.patterns): the app client and the Cloud Functions. Repo
// tooling (scripts/, docs/) and prose are NOT code here — a linter tweak or a doc edit
// must keep routing `skip`, or every ownership gap turns into a review nobody needs.
const CODE_ROOTS = ['src/', 'functions/', 'extension/', 'shared/'];

// …with ONE deliberate exception (BIN-805, Malin's call 2026-08-08, alternative (a)):
// the router itself and the repo's gate scripts ARE code here, even though they live
// under docs/ and scripts/. They reach no user, but they decide who reviews everything
// else — a change to route.mjs that quietly widens `skip` would clear its own review, and
// a change to the workflow-map linter can make a CI/deploy gate stop failing. The narrow
// list is the whole point: the alternative (all of docs/ + scripts/ as code) would pull a
// reviewer into every helper-script tweak, so the rest of that tooling keeps routing as
// before. Test siblings are listed too — deleting a gate's test is the same hole as
// deleting the gate. The commit-gate hooks themselves live outside this repo
// (C:/claude-plugins), so they never appear in a blast radius here.
// BIN-864 + BIN-873 (2026-08-12) added the second pair each: `gen-ownership-map.mjs`
// computes the ownership map this router reads — it decides who owns what — and
// `check-public-env.mjs` is the guard that exists because a public env var went missing
// from the production build for three months with CI and deploy green (BIN-849). Both
// routed `skip` until now. Keep this set and `reviewGates` in `.claude/shared-plugin.json`
// IDENTICAL: one advises, the other blocks, and widening one has never widened the other.
// BIN-874 (2026-08-14) stopped that being a promise a human has to remember: this set is
// EXPORTED so `docs/org/route.test.mjs` can compare it against the blocking gate's real
// patterns — and against a third, independent signal (the `.test.mjs` siblings inside
// vitest's own `include` globs) — instead of against a hand-copied list. All four
// widenings before that were reactive, found by a reviewer after the hole already existed.
// BIN-880 (2026-08-16) added `gate-symmetry.test.mjs`, the check that walks the whole
// tracked tree comparing THIS router's answer against the blocking gate's. It is review
// machinery by definition, so it belongs in both lists for the same reason route.test.mjs
// does: weakening the check must not be a change nobody reviews.
export const TOOLING_CODE_FILES = new Set([
  'docs/org/route.mjs',
  'docs/org/route.test.mjs',
  'docs/org/gate-symmetry.test.mjs',
  // BIN-998. The twin id-shape guard: firestore.rules carries the same
  // `id.matches(...)` expression twice, as two deliberate copies, and until this file
  // existed nothing checked that they change together — the invariant lived only in
  // prose at both sites. Added here in the SAME commit as its `reviewGates` pattern,
  // per BIN-830: widening one of the two lists never widens the other.
  //
  // It is a plain vitest file rather than a `check-*.mjs` CLI, so it needs no entry in
  // scripts/scripts-self-tests-present.test.mjs's REQUIRED floor. It is under docs/org/
  // rather than src/test/rules/ because vitest.config.ts EXCLUDES that directory: the
  // rules suite runs only behind `npm run test:rules`, which needs Java and the
  // emulator, and this check reads firestore.rules as plain text and needs neither.
  'docs/org/rules-doc-id-symmetry.test.mjs',
  // BIN-1002. The sibling of the line above, and the LARGER of the two invariants: it holds
  // firestore.rules' id-shape regex against the ids src/lib/mediaTypeDocId.ts actually
  // builds. Drift between the two rules copies makes one collection stricter than the other;
  // drift between the rules and the client means the app writes ids the rules refuse, or the
  // rules admit shapes the app cannot read back — BIN-797's shape. Added here in the SAME
  // commit as its `reviewGates` pattern, per BIN-830.
  'docs/org/rules-id-client-symmetry.test.mjs',
  'docs/org/gen-ownership-map.mjs',
  'docs/org/gen-ownership-map.test.mjs',
  // BIN-1088. The dependency-diff check on the pull_request path. Dependabot merges
  // server-side, so that path reaches no reviewGates reviewer and no push gate. Added
  // here in the SAME commit as
  // its `reviewGates` pattern, per BIN-830 — one list advises, the other blocks, and
  // widening one has never widened the other.
  'scripts/check-dependency-diff.mjs',
  'scripts/check-dependency-diff.test.mjs',
  'scripts/check-workflow-map.mjs',
  'scripts/check-workflow-map.test.mjs',
  'scripts/check-public-env.mjs',
  'scripts/check-public-env.test.mjs',
  // BIN-997. The reviewer knowledge-file cap check. Added here in the SAME commit that
  // creates it, per BIN-830 — widening one of the two lists never widens the other, and
  // both of this repo's symmetry checks nominated these two files the moment they existed
  // (route.test.mjs's BIN-874 block on the .mjs, gate-symmetry.test.mjs's rule B on the
  // .test.mjs). That is the discovery half working as designed rather than a reviewer
  // finding the hole afterwards.
  //
  // The check itself is a WARNING and cannot red a build (Malin, 2026-08-25). Its entry
  // here is not about that: it is review machinery, so weakening it — raising the cap to
  // fit, loosening the glob, lowering the file floor — must not be a change nobody reviews.
  'scripts/check-knowledge-caps.mjs',
  'scripts/check-knowledge-caps.test.mjs',
  // BIN-790. The pre-commit pruner that DELETES entries out of the workflow-map staleness
  // flag. It belongs here for the same reason `.claude/hooks/freshness.mjs` does, one step
  // further along the same pipe: that file decides what the next session is TOLD to
  // re-trace, and this one decides what it is no longer told. Weakening it — widening the
  // DROP branch, dropping the keep-on-throw, quietly removing the lefthook entry — must
  // not be a change nobody reviews, because the loss is invisible by construction: the
  // flag is gitignored, so no diff-based gate can see a work order disappear.
  //
  // Added in the SAME commit as its `reviewGates` pattern, per BIN-830 — one list advises,
  // the other blocks, and widening one has never widened the other. Both names were
  // nominated by route.test.mjs's BIN-874 block the moment the files existed.
  'scripts/prune-map-flag.mjs',
  'scripts/prune-map-flag.test.mjs',
  // BIN-1009. The PostToolUse hook that stamps the workflow-map staleness flag, and its
  // first test. The hook was already in the blocking gate's pattern; it enters the
  // ADVISING list now because it finally has a test inside vitest's include globs, which
  // is the condition route.test.mjs's BIN-874 block keys on. Both names added together —
  // widening one list never widens the other (BIN-830).
  //
  // It belongs here for the same reason route.mjs itself does: it decides what the NEXT
  // session is told to re-trace, so weakening it must not be a change nobody reviews.
  '.claude/hooks/freshness.mjs',
  '.claude/hooks/freshness.test.mjs',
  // BIN-1036. The sibling gate — a PreToolUse(Write) block on creating a new screen
  // before design directions have been shown. Its `.test.mjs` is new in this commit, and
  // the discovery half of the BIN-874 check is keyed on that sibling existing: until now
  // the production file was nominated by nothing, which is the blind spot the comment on
  // `check_events.mjs` above names. `reviewGates`' integration pattern already covered
  // both spellings, so this commit widens only the list that was actually short — BIN-830
  // is about the two lists AGREEING, not about editing both reflexively.
  '.claude/hooks/preview-gate.mjs',
  '.claude/hooks/preview-gate.test.mjs',
  // BIN-918. The metrics-log claim check. Added here in the SAME commit as its
  // `reviewGates` pattern. What named the gap was route.test.mjs's BIN-874 block —
  // "has a test in vitest's include globs but is missing from TOOLING_CODE_FILES" —
  // which flagged both files. gate-symmetry.test.mjs flagged only the .test.mjs
  // sibling; the production file matched none of its three rules. Note what that
  // means: the discovery half is keyed on a `.test.mjs` sibling EXISTING, so a
  // tooling .mjs shipped without a test is nominated by nothing at all.
  'docs/org/metrics/check_events.mjs',
  'docs/org/metrics/check_events.test.mjs',
  // BIN-1059. The commit-msg gate that re-routes the STAGED files and refuses a commit
  // whose panel no `review` row names. It is review machinery in the most direct sense —
  // it decides which critique a change owed — so weakening it must not be a change nobody
  // reviews. Added here in the SAME commit as its `reviewGates` pattern, per BIN-830:
  // one list advises, the other blocks, and widening one has never widened the other.
  'docs/org/metrics/check_staged_routing.mjs',
  'docs/org/metrics/check_staged_routing.test.mjs',
  // The log's only IN-REPO writer helper, added alongside its reader. It routed
  // skip/doc-only with no gate at all, so this commit's TWO edits to it — `correction`
  // added to its type enum, and its shebang deleted — reached zero reviewers. And
  // gate-symmetry could not see that either, since "no owner and no gate" is the blind
  // spot named in its own header. Found by a reviewer, not by a check.
  //
  // The shebang removal is prophylactic: the same line on check_events.mjs made that
  // module unparseable under vitest once it picked up CRLF endings, silently dropping 31
  // tests from the suite. Nothing invokes either file directly. See _note8 in
  // .claude/shared-plugin.json for the full account.
  //
  // Do NOT read this as "the log's write path is now reviewed". The four rows BIN-918
  // exists for never went through this file: the sprint engine in C:/claude-plugins
  // appends to events.jsonl directly, and so does suggest-stakeholder-review.mjs for
  // every `trigger` row. TWO callers do use the helper: shared-plugin.json's
  // delivery.metrics.logReviewCommand (`review` rows) and the /org-retro skill (`retro`
  // rows — all three `retro` rows in events.jsonl went THROUGH the helper). Gating it costs nothing and is right; it just
  // buys less than it sounds like. ("The one caller" here was wrong until the tenth
  // integration pass measured it.)
  'docs/org/metrics/log_event.mjs',
  // BIN-917's coverage check and its test, added in the SAME commit as their entry in
  // .claude/shared-plugin.json's integration-gate alternation — the BIN-830 lesson, which
  // is that widening one of the two lists never widens the other. It asks the inverse
  // question to its check_events.mjs neighbour: not "does this row carry its evidence"
  // but "is there a row at all", because the 2026-08-16 failure was silence rather than
  // a false claim. Two modes: `--message` runs from lefthook's `commit-msg` hook and refuses
  // the commit being written (BIN-917 criterion 4, literally); with no flag it walks history
  // as a backstop for anything that got in before the hook existed or with `LEFTHOOK=0`.
  // WHICH RUNNER REACHES WHICH MODE is derived, not stated here (BIN-1040); the module's
  // own header carries the commands that answer it. The first draft shipped only the second and declared
  // the first impossible — "no .husky, no precommit in package.json" — which was two true
  // probes and a false conclusion: `lefthook.yml` had been the commit-time mechanism here
  // since 2026-08-08.
  'docs/org/metrics/check_review_coverage.mjs',
  'docs/org/metrics/check_review_coverage.test.mjs',
  // BIN-931's custom ESLint rule and its test, added in the SAME commit as their entry in
  // .claude/shared-plugin.json's integration-gate alternation — the BIN-830 lesson again.
  // It is review machinery by the same definition the entries above use: `npm run lint`
  // fails on it, and CI runs `npm run lint`, so weakening the rule weakens a check that
  // refuses commits. It replaced regex source scans that lived in a test file and were
  // therefore already gated; moving that guard OUT of the test tree would have quietly
  // moved it out of review too, which is the drift this list exists to stop.
  //
  // What named the gap: route.test.mjs's BIN-874 discovery half, the moment
  // 'eslint-rules/**/*.{test,spec}.mjs' entered vitest.config.ts's include globs — it went
  // red naming both files by path.
  //
  // This block used to record eslint.config.mjs as deliberately NOT here, on the ground
  // that a red test already priced the risk. SUPERSEDED 2026-08-23 by BIN-967; the decision
  // that replaces it is below.
  'eslint-rules/no-bare-streaming-offers-id.mjs',
  'eslint-rules/no-bare-streaming-offers-id.test.mjs',
  // THE FILE THAT SWITCHES THE RULE ON IS ALSO REVIEW MACHINERY. Decided 2026-08-23,
  // BIN-967, and added in the SAME commit as its `reviewGates` pattern (_note12) per the
  // BIN-830 rule: this router only ADVISES, `.claude/shared-plugin.json` BLOCKS, and
  // widening one never widens the other.
  //
  // The two files above are gated, so the rule cannot be weakened unwitnessed — but the
  // switch is one hop further out, and emptying this config's `rules` block disarms the
  // rule completely while every gated file stays byte-identical. That is _note4's "the
  // gate could disarm itself unwitnessed", read one file along, and it is the same argument
  // BIN-869 used to put the integration reviewer's own instruction file behind its own gate.
  //
  // WHAT THE RED TEST ACTUALLY COVERS, re-measured for this ticket rather than carried
  // forward as prose: with the `rules` block set to `{}`,
  // `npx vitest run eslint-rules/no-bare-streaming-offers-id.test.mjs` answers
  // `9 failed | 6 passed (15)`. So the disarm is caught — by `npm test`, which gates the
  // DEPLOY. It was never caught at COMMIT time, and code reaching main past a red suite is
  // exactly what the two-list pairing exists to stop.
  //
  // COST: the new obligation lands on a file that changes rarely — derive it with
  // `git log --oneline --no-merges -- eslint.config.mjs | wc -l`. Malin's narrow-over-broad standing call (2026-08-08, alternative (a)) was
  // the previous entry's reason for leaving it out and is honoured rather than overridden:
  // one exact filename in each of the two lists, the shape BIN-934 used for
  // package-lock.json — not a directory, not a glob.
  'eslint.config.mjs',
]);
// Root-level files that ARE code even though they sit outside CODE_ROOTS. BIN-880 added
// the two remaining root test-runner configs: the blocking gate already stops a commit
// touching either (`\.(ts|tsx)$`, plus `vitest.*\.config\.ts$` for the rules runner) while
// this router answered `skip` — a commit held for a review the router called unnecessary,
// the same drift as BIN-830 seen from the other side. Widening the ROUTER, not the gate,
// is the conservative half of that pair: it adds no new blocking obligation.
//
// LOCKFILES ARE CODE. Decided 2026-08-22, BIN-934; the question was left explicitly open
// by BIN-919 ("whether that is right is an open question") and is settled here rather
// than in passing, because the two lockfiles had landed in different classes by accident:
// `functions/package-lock.json` is code because `functions/` is a CODE_ROOT and `.json` is
// a code extension, while the ROOT lockfile matched nothing at all and routed `skip`. Not
// a judgment either way — nobody ever chose.
//
// The argument for calling them code is that the manifest is not the thing that decides
// what gets installed. `package.json` carries the ranges; the lockfile carries the
// resolved graph, which is where a transitive dependency actually changes. A lockfile-only
// update (`npm audit fix`, a transitive bump) touches no other file, so treating the
// manifest as reviewed code while the lockfile is invisible reviews the intention and not
// the bytes. BIN-658 is the live example — CVEs arriving through the eslint chain, in
// packages no line of this repo names.
//
// Applied to BOTH, and the blocking gate moved in the same commit (the BIN-830 rule):
// `.claude/shared-plugin.json` now matches both lockfiles for binge-integration-reviewer.
// That is the same reviewer class BIN-919 chose for `package.json`, deliberately.
// `functions/package-lock.json` ALSO reaches binge-security-reviewer, via that gate's
// blanket `^functions/` prefix — incidentally, exactly as `functions/package.json` does,
// and for the same reason. Nobody chose a supply-chain policy for the functions tree;
// the prefix is broad on purpose and
// narrowing it to buy symmetry would trade a real guard for a cosmetic one.
//
// The cost, stated: a lockfile-only commit now routes `medium` and is stopped by a
// reviewer. Neither lockfile has an OWNING role — they answer `unmapped-code` and seat
// the #14 fallback — and that is left alone here on purpose. Ownership is a separate
// decision (§25 declined it in BIN-919 and the sentence saying so is corrected in the
// same commit as this one); what A1 requires is that the path reach a reviewer, and it now
// does.
const CODE_ROOT_FILES = new Set([
  'firestore.rules',
  'firestore.indexes.json',
  'firebase.json',
  'next.config.mjs',
  'tailwind.config.ts',
  'vitest.config.ts',
  'vitest.rules.config.ts',
  'vitest.setup.ts',
  'package.json',
  'package-lock.json',
]);
const CODE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|rules)$/;

// ── Path matching ────────────────────────────────────────────────────────────────────

// A pattern from the ownership map is an exact file ("firestore.rules"), a directory
// (trailing slash "src/components/ui/" or bare "src/lib/advisor"), or may contain a glob.
function matches(path, pattern) {
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const pat = pattern.replace(/\\/g, '/');
  if (pat.includes('*')) {
    const re = new RegExp(
      '^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$',
    );
    return re.test(p);
  }
  if (pat.endsWith('/')) return p === pat.slice(0, -1) || p.startsWith(pat);
  return p === pat || p.startsWith(pat + '/');
}

const normalize = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');

// "src/lib/tmdb/client.ts" -> "src/lib/tmdb/"; a root file -> "".
function dirOf(path) {
  const p = normalize(path);
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i + 1);
}

// Is this a path where a MISSING owner is dangerous (app/functions code) rather than
// simply uninteresting (docs, plans, scratch)? Drives the unmapped-vs-trivial split and
// gates directory inheritance, so a doc edit never inherits a code role.
export function isCodePath(path) {
  const p = normalize(path);
  if (CODE_ROOT_FILES.has(p) || TOOLING_CODE_FILES.has(p)) return true;
  return CODE_ROOTS.some((r) => p.startsWith(r)) && CODE_EXT_RE.test(p);
}

// Directory-level ownership (BIN-788). The map lists files, so `src/lib/tmdb/newThing.ts`
// matched nothing even though ten siblings are owned. A role owns a directory when it
// owns at least one concrete file directly in it; the count is the tie-breaker (the role
// with most files there is the more plausible reviewer). Glob and directory patterns are
// skipped — they already match recursively in `matches()`.
function ownedDirs(patterns) {
  const dirs = new Map(); // dir -> how many of this role's files live there
  for (const pat of patterns) {
    if (pat.includes('*') || pat.endsWith('/')) continue;
    const dir = dirOf(pat);
    if (!dir) continue;
    dirs.set(dir, (dirs.get(dir) || 0) + 1);
  }
  return dirs;
}

// ── Routing ──────────────────────────────────────────────────────────────────────────

export function route(paths) {
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  const clean = paths.map((p) => p.trim()).filter(Boolean);

  // role num -> { num, title, slug, matched:Set, inherited:Set, specificity, weight }
  const owners = new Map();
  const matchedPaths = new Set();
  const seatOwner = (num, role) => {
    const n = Number(num);
    if (!owners.has(n)) {
      owners.set(n, {
        num: n,
        title: role.title,
        slug: role.slug,
        matched: new Set(),
        inherited: new Set(),
        specificity: 0,
        weight: 0,
      });
    }
    return owners.get(n);
  };

  for (const [num, role] of Object.entries(map.roles)) {
    const dirs = ownedDirs(role.patterns);
    for (const path of clean) {
      // The LONGEST matching pattern, not the first: a role owning both
      // `src/components/ui/` and `src/components/ui/DuotonePoster.tsx` is the specific
      // owner of that file, and the map is stored alphabetically (dir first).
      const hit = role.patterns
        .filter((pat) => matches(path, pat))
        .reduce((best, pat) => (best == null || pat.length > best.length ? pat : best), null);
      if (hit) {
        const o = seatOwner(num, role);
        o.matched.add(path);
        o.specificity = Math.max(o.specificity, hit.length); // longer pattern = more specific owner
        matchedPaths.add(path);
        continue;
      }
      // Directory inheritance — only for code paths (BIN-788).
      const dir = dirOf(path);
      if (!dir || !isCodePath(path) || !dirs.has(dir)) continue;
      const o = seatOwner(num, role);
      o.matched.add(path);
      o.inherited.add(path);
      o.specificity = Math.max(o.specificity, dir.length); // a directory is less specific than a file
      o.weight = Math.max(o.weight, dirs.get(dir));
      matchedPaths.add(path);
    }
  }

  const highStakes = clean.filter((path) => HIGH_STAKES.some((hs) => matches(path, hs)));
  const ownerList = [...owners.values()].map((o) => ({ ...o, matched: [...o.matched], inherited: [...o.inherited] }));
  const unmapped = clean.filter((path) => !matchedPaths.has(path));
  const unmappedCode = unmapped.filter(isCodePath);

  // Tier decision (DESIGN §1.3, + the unmapped/trivial split from BIN-788)
  let tier;
  let reason;
  let reasonCode;
  const codeOwners = ownerList.filter((o) => o.num !== TECH_WRITER);
  const ownedOnlyByWriter = ownerList.length === 1 && ownerList[0].num === TECH_WRITER;

  // Code with NO code-owning role: either nothing matched it at all (`unmappedCode`), or
  // the only role that matched is the Technical Writer — who is never the sole reviewer of
  // a code change. `docs/org/route.mjs` used to land in that second case, since #21 owns
  // all of `docs/` (BIN-805); BIN-834 gave it #25, so the live example of the
  // writer-only branch is now any NEW code file under `docs/` that #25's patterns and
  // directory inheritance do not reach. Both cases get the same answer: seat the
  // architect and name the path so the map gets fixed.
  const pathsOwnedByCodeRole = new Set(codeOwners.flatMap((o) => o.matched));
  const unownedCode = clean.filter((path) => isCodePath(path) && !pathsOwnedByCodeRole.has(path));
  if (highStakes.length > 0) {
    tier = 'top';
    reasonCode = 'high-stakes';
    reason = `high-stakes path(s) ${highStakes.join(', ')} → full panel`;
  } else if (codeOwners.length > 0) {
    tier = 'medium';
    reasonCode = 'owned';
    reason = 'single medium-impact area → one owning role';
  } else if (unownedCode.length > 0) {
    // NOT a skip: nobody reviews this code, which is an unknown blast radius, not a
    // cleared one. Seat the architect and say the map needs the path added.
    tier = 'medium';
    reasonCode = 'unmapped-code';
    reason = `code path(s) with no owning role: ${unownedCode.join(', ')} — nothing in docs/org/ownership-map.json reviews them (Technical Writer #${TECH_WRITER} does not count for code); seating #${UNMAPPED_FALLBACK_ROLE} Software Architect. Add the path to docs/role-responsibilities.md and regenerate the map.`;
  } else if (ownedOnlyByWriter) {
    tier = 'skip';
    reasonCode = 'doc-only';
    reason = 'doc-only (Technical Writer #21 only)';
  } else {
    tier = 'skip';
    reasonCode = 'no-code-paths';
    reason = 'no code paths (docs / plans / scratch) — deliberately trivial, not unmapped';
  }
  if (tier !== 'skip' && reasonCode !== 'unmapped-code' && unownedCode.length > 0) {
    reason += `; also ${unownedCode.length} code path(s) with no owning role: ${unownedCode.join(', ')}`;
  }

  // Panel selection
  let panel = [];
  if (tier === 'top') {
    // seat high-stakes-owning roles first, then by specificity, then match count, then num
    panel = [...ownerList]
      .sort((a, b) => {
        const ha = HIGH_STAKES_ROLES.has(a.num) ? 1 : 0;
        const hb = HIGH_STAKES_ROLES.has(b.num) ? 1 : 0;
        if (ha !== hb) return hb - ha;
        if (a.specificity !== b.specificity) return b.specificity - a.specificity;
        if (a.weight !== b.weight) return b.weight - a.weight;
        if (a.matched.length !== b.matched.length) return b.matched.length - a.matched.length;
        return a.num - b.num;
      })
      .slice(0, PANEL_CAP)
      .map((o) => o.num);
  } else if (reasonCode === 'unmapped-code') {
    panel = [UNMAPPED_FALLBACK_ROLE];
  } else if (tier === 'medium') {
    // the single most-specific owner, preferring a code role over Technical Writer
    const pick = (codeOwners.length ? codeOwners : ownerList).sort(
      (a, b) =>
        b.specificity - a.specificity ||
        b.weight - a.weight ||
        b.matched.length - a.matched.length ||
        a.num - b.num,
    )[0];
    panel = pick ? [pick.num] : [];
  }

  const seated = new Set(panel);
  const dropped = ownerList.filter((o) => !seated.has(o.num)).map((o) => `${o.num} ${o.title}`);

  return {
    tier,
    reason,
    reasonCode,
    highStakes,
    panel,
    roles: ownerList.sort((a, b) => a.num - b.num).map(({ specificity, weight, ...r }) => r),
    dropped,
    unmapped,
    unmappedCode,
    unownedCode,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// Exported for the same reason `mdBlock` is: a consumer that names a role in a BLOCK message
// has to be able to name the fallback seat too. It is never in `roles`, because nothing
// matched it — so a reader deriving titles from `roles` alone gets a bare number for the one
// case the router itself invented (BIN-1059).
export const ROLE_TITLES = { [UNMAPPED_FALLBACK_ROLE]: 'Software Architect' };

// The `--md` form is what the tooling actually consumes: `.claude/shared-plugin.json` sets
// `delivery.router.command` to `node docs/org/route.mjs --md`, and CLAUDE.md's casting step
// reads the same block. Exported so route.test.mjs can pin it directly instead of scraping
// stdout — the surface every gate reads was the one surface no test touched (BIN-832).
export function mdBlock(r) {
  if (r.tier === 'skip') return '## Stakeholders\n\n_None — trivial / doc-only change (no review tier)._';
  const names = r.panel.map((n) => {
    const role = r.roles.find((x) => x.num === n);
    return role ? `#${n} ${role.title}` : `#${n}${ROLE_TITLES[n] ? ` ${ROLE_TITLES[n]}` : ''}`;
  });
  const gap = r.unownedCode?.length
    ? `\n\n_⚠ Unowned code path(s): ${r.unownedCode.join(', ')} — add them to \`docs/role-responsibilities.md\` and regenerate \`docs/org/ownership-map.json\`._`
    : '';
  return `## Stakeholders\n\nTier **${r.tier}** · ${names.join(', ')}\n\n_Routed via \`docs/org/route.mjs\` (${r.reason}). Run \`/stakeholder-review\` before building if this is a plan._${gap}`;
}

function selftest() {
  const cases = [
    { paths: ['firestore.rules'], tier: 'top', mustSeat: 4 },
    { paths: ['src/lib/firebase/userData.ts'], tier: 'top', mustSeat: 6 },
    { paths: ['src/components/ui/DuotonePoster.tsx'], tier: 'medium', mustSeat: 1 },
    { paths: ['public/llms.txt'], tier: 'skip', reasonCode: 'doc-only' }, // owned only by #21
    { paths: ['README-does-not-exist.xyz'], tier: 'skip', reasonCode: 'no-code-paths' },
    // a real runbook change DOES have an owner (#20 Manual/Release QA) — not a skip:
    { paths: ['docs/RUNBOOK.md'], tier: 'medium', mustSeat: 20 },

    // ── BIN-788 ──────────────────────────────────────────────────────────────────────
    // The doc-id contract behind BIN-569/608/624/766 is explicitly #27's now.
    { paths: ['src/lib/mediaTypeDocId.ts'], tier: 'medium', mustSeat: 27, reasonCode: 'owned' },
    { paths: ['src/lib/watchlist/addedAt.ts'], tier: 'medium', mustSeat: 27, reasonCode: 'owned' },
    // A file NOT in the map, in a directory whose siblings are owned → inherited, not skip.
    // The path is deliberately one that does not exist: BIN-871 gave an owner to the real
    // file this case used to name, which took the inheritance branch away while the case
    // stayed green — it asserts tier and reasonCode, which a directly-owned file also
    // satisfies. route() matches on the string and never asks the filesystem.
    { paths: ['src/lib/tmdb/__unlisted-sibling.ts'], tier: 'medium', reasonCode: 'owned' },
    { paths: ['src/components/pages/MoviePageClient.tsx'], tier: 'medium', mustSeat: 26, reasonCode: 'owned' },
    // Code nobody owns at all is an UNKNOWN blast radius, not a cleared one.
    { paths: ['src/lib/no-such-dir/brandNew.ts'], tier: 'medium', mustSeat: 14, reasonCode: 'unmapped-code' },
    // …but ordinary repo tooling and prose still route skip — inheritance never fires
    // off code.
    { paths: ['scripts/gen-app-icons.mjs'], tier: 'skip', reasonCode: 'no-code-paths' },
    { paths: ['tasks/todo.md'], tier: 'skip', reasonCode: 'no-code-paths' },

    // ── BIN-805 ──────────────────────────────────────────────────────────────────────
    // The router and the gate scripts review everything else, so they can no longer
    // clear themselves as doc-only.
    // BIN-834 gave the router and the map generator a real owner (#25) — they decide who
    // reviews everything else, and until then the router permanently printed "add the path
    // and regenerate the map" about ITSELF, an instruction nobody was assigned to follow.
    // These two pins moved with that change, and BIN-1080 moved the third: the gate scripts
    // under scripts/ have named owners now. The fallback branch is pinned by the
    // src/lib/no-such-dir/brandNew.ts case above, which stays unownable because no role
    // names that directory.
    { paths: ['docs/org/route.mjs'], tier: 'medium', mustSeat: 25, reasonCode: 'owned' },
    { paths: ['docs/org/route.test.mjs'], tier: 'medium', mustSeat: 25, reasonCode: 'owned' },
    { paths: ['scripts/check-workflow-map.mjs'], tier: 'medium', mustSeat: 25, reasonCode: 'owned' },

    // ── BIN-864 / BIN-873 ────────────────────────────────────────────────────────────
    // Same class, two more files — and as of BIN-869 they no longer answer the same way,
    // so they are pinned differently on purpose.
    //
    // `gen-ownership-map.mjs` got a REAL owner in this commit (#25, alongside route.mjs
    // and route.test.mjs — it computes the map this router reads), so its case is now
    // pinned as specifically as the BIN-805 ones above. Leaving it at bare `tier` would
    // have been the looser pin outliving the reason for looseness: docs/org/route.test.mjs
    // already asserts `owned` / `[25]` for this exact path, and a golden case that stayed
    // vague while the gating test was specific is how one file ends up with two answers.
    //
    // No breakdown of TOOLING_CODE_FILES is written here. Derive it from the set instead of
    // reading a number here.
    //
    // `--selftest` used to be invoked by NOTHING — not package.json, not deploy.yml,
    // not a hook — so a stale pin here could not fail a deploy, and a
    // documented command ("exit non-zero on fail" in the Usage block above) that nobody
    // runs teaches the next reader to ignore it. BIN-880 wired it: docs/org/gate-symmetry
    // .test.mjs spawns this exact command and fails if it exits non-zero, and `npm test`
    // gates deploy.yml. A red case here now stops a release.
    { paths: ['docs/org/gen-ownership-map.mjs'], tier: 'medium', mustSeat: 25, reasonCode: 'owned' },
    { paths: ['scripts/check-public-env.mjs'], tier: 'medium', mustSeat: 4, reasonCode: 'owned' },
    // A high-stakes path outranks everything, even when nothing else in the set is owned.
    { paths: ['firestore.rules', 'src/lib/no-such-dir/brandNew.ts'], tier: 'top', mustSeat: 4 },
  ];
  let failed = 0;
  for (const c of cases) {
    const r = route(c.paths);
    const okTier = r.tier === c.tier;
    const okSeat = c.mustSeat == null || r.panel.includes(c.mustSeat);
    const okReason = c.reasonCode == null || r.reasonCode === c.reasonCode;
    if (!okTier || !okSeat || !okReason) {
      failed++;
      console.error(`FAIL ${JSON.stringify(c.paths)} → tier=${r.tier} reasonCode=${r.reasonCode} panel=${JSON.stringify(r.panel)} (wanted tier=${c.tier}${c.mustSeat != null ? `, seat ${c.mustSeat}` : ''}${c.reasonCode != null ? `, reasonCode ${c.reasonCode}` : ''})`);
    } else {
      console.log(`ok   ${JSON.stringify(c.paths)} → ${r.tier} ${r.reasonCode} ${JSON.stringify(r.panel)}`);
    }
  }
  if (failed) {
    console.error(`\n${failed} selftest case(s) failed.`);
    process.exit(1);
  }
  console.log('\nall selftest cases passed.');
}

function main(argv) {
  if (argv[0] === '--selftest') {
    selftest();
    return;
  }
  const wantMd = argv[0] === '--md';
  const args = wantMd ? argv.slice(1) : argv;
  let paths = args;
  if (paths.length === 0) paths = readStdin().split(/\r?\n/);
  paths = paths.map((p) => p.trim()).filter(Boolean);
  if (paths.length === 0) {
    console.error('usage: node docs/org/route.mjs <path> [<path> ...]   (or pipe `git diff --name-only`)');
    process.exit(1);
  }
  const r = route(paths);
  console.log(wantMd ? mdBlock(r) : JSON.stringify(r, null, 2));
}

// Run the CLI only when this file IS the entry point. Without the guard, merely
// importing `route` (which docs/org/route.test.mjs does) ran the CLI with the test
// runner's argv, printed a usage error and called process.exit(1) — i.e. the module
// was untestable, which is half of why it had no tests (BIN-802).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
