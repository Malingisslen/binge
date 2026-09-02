#!/usr/bin/env node
// prune-map-flag.mjs — pre-commit cleanup of `.claude/state/workflow-map-stale.json`.
//
// WHAT THE FLAG IS. `.claude/hooks/freshness.mjs` stamps that file (gitignored) with a
// `triggers` array whenever a Write/Edit tool call touches a file `docs/workflow-map.html`
// lists as a node path. CLAUDE.md then tells the next session to re-trace those flows.
//
// THE DEFECT THIS CLOSES (BIN-790, filed after the flag survived four sprints and was
// cleaned by hand four times). A batch that gets WITHDRAWN — stashed, reverted, pulled from
// the sprint — leaves its triggers behind. The edit never reached any commit and is no
// longer in the tree, so the next session is sent to re-trace a file nobody changed. The
// flag is gitignored, so no diff-based gate can see it: "ghost work order" and "real work
// order" are the same bytes.
//
// WHY NOT THE OBVIOUS RULE. The ticket originally asked to drop any trigger whose file is
// unchanged vs HEAD. That deletes the work order in the NORMAL flow, because map edits must
// be their own commit (the `e2cf608` lesson: a feature-revert silently dropped unrelated
// flow docs bundled with feature code):
//
//   1. code edited          → hook stamps the trigger
//   2. code committed alone → the file now equals HEAD, and the map is still not updated
//   3. map re-traced and committed separately
//
// A bare HEAD comparison fires between 2 and 3 — exactly when the note is needed most.
//
// THE RULE, therefore, asks both questions rather than one. Per trigger:
//
//   • the file differs from HEAD in the working tree      → KEEP (the edit is still live)
//   • no commit since `firstStampedAt` touched the file   → DROP (ghost: it was withdrawn)
//   • otherwise                                            → KEEP (committed, map lagging)
//
// NEVER BLOCKS. This exits 0 unconditionally — on a corrupt flag, a missing flag, a failing
// git call, anything. It is a cleanup, not a gate, and that is what keeps it outside the
// class of change `freshness.mjs`'s own dated deviation block declines to build (a new
// BLOCKING obligation on shared commit machinery, for the separate git-apply gap of
// BIN-969). It stays silent unless it actually drops something, so the flag can never empty
// itself with nobody watching.
//
// NOT COVERED, and it is a different repo's job: making a WITHDRAWN batch clear its own
// flags at the moment it is pulled. That lives in the sprint engine under
// `C:/claude-plugins` and is point 2 of BIN-790.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FLAG_REL = '.claude/state/workflow-map-stale.json';

/**
 * The repo root, resolved WITHOUT spawning anything.
 *
 * This is not a stylistic preference. The cheap path below must cost no subprocess at all,
 * and a `git rev-parse --show-toplevel` here would run BEFORE the flag check on every
 * commit — which is exactly the hole the outcome verifier found in the first version of
 * this file: the cost measurement had set `CLAUDE_PROJECT_DIR`, and lefthook does not, so
 * the number was measured on a path real commits never take.
 *
 * Walking up for `.git` answers the same question from the filesystem. `.git` is a
 * directory in a normal clone and a FILE in a worktree or submodule, so this tests for
 * existence, not for a directory.
 */
export function findRepoRoot(startDir) {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString();
}

/** Working tree differs from HEAD for this path — the edit is still sitting there. */
export function hasWorkingTreeChange(root, rel, run = git) {
  // Covers both staged and unstaged: `git status --porcelain -- <path>` is non-empty for
  // either. `git diff HEAD` alone would miss a path that is staged and then restored.
  return run(root, ['status', '--porcelain', '--', rel]).trim() !== '';
}

/**
 * Did any commit since `since` touch this path?
 *
 * `--since` is compared by git against the COMMITTER date. `firstStampedAt` is written by
 * the hook as an ISO-8601 UTC string with a `Z`, and git parses that offset rather than
 * assuming local time — which is the BIN-1050 footgun this deliberately avoids (`%cI`
 * carries a local offset, so a naive string compare goes wrong by the offset). The unit
 * test drives a commit inside the same minute as the stamp to hold that down.
 */
export function hasCommitSince(root, rel, since, run = git) {
  return run(root, ['log', '--oneline', `--since=${since}`, '--', rel]).trim() !== '';
}

/**
 * Which triggers survive. Pure, so the three branches are testable without a repo.
 *
 * Anything that throws while probing a single trigger KEEPS that trigger: a git call we
 * could not answer must never be read as "the edit was withdrawn".
 */
export function pruneTriggers(root, flag, deps = {}) {
  const {
    workingTreeChange = hasWorkingTreeChange,
    commitSince = hasCommitSince,
    gitRunner = git,
  } = deps;
  const since = flag.firstStampedAt;
  const kept = [];
  const dropped = [];
  for (const rel of flag.triggers ?? []) {
    let live = true;
    try {
      // No `firstStampedAt` means we cannot date the search window, so we cannot tell a
      // ghost from a committed edit. Keep it.
      if (since) {
        live = workingTreeChange(root, rel, gitRunner) || commitSince(root, rel, since, gitRunner);
      }
    } catch {
      live = true;
    }
    (live ? kept : dropped).push(rel);
  }
  return { kept, dropped };
}

/**
 * The whole job, with its two outside dependencies injectable.
 *
 * `gitRunner` is a parameter rather than a hardcoded call so a test can COUNT the
 * subprocesses instead of asserting about them from the source text. The first version of
 * this file carried a test that scanned `main()`'s body for the early return and passed
 * while a `git rev-parse` ran one frame up, inside the root resolution — an assertion
 * about the code, not a measurement of it.
 */
export function run({
  cwd = process.cwd(),
  // EXPLICIT, not read from the environment inside the body. Precedence still matches
  // `.claude/hooks/freshness.mjs` in production — do not invert it — but reading the env
  // var down there made an injected `cwd` silently useless: a test that hands in a scratch
  // repo would resolve `root` to the REAL one whenever the variable happened to be set,
  // read the real flag, drop every trigger against a stubbed git, and `unlinkSync` a
  // genuine work order as a side effect of `npm test`. The flag is gitignored, so nothing
  // would have shown it. Found by the integration review before this ever ran that way.
  projectDir = process.env.CLAUDE_PROJECT_DIR,
  gitRunner = git,
  out = process.stdout,
} = {}) {
  const root = projectDir || findRepoRoot(cwd);
  if (!root) return;

  const flagPath = join(root, FLAG_REL);
  // The common case, and it must cost nothing: no flag, no subprocess at all — note that
  // the root above is resolved from the filesystem for exactly this reason. Every other
  // pre-commit command in lefthook.yml is glob-gated to stay off commits it has no
  // business on; this one cannot be (a ghost trigger is unrelated to what is staged), so
  // this early return is what takes its place.
  if (!existsSync(flagPath)) return;

  let flag;
  try { flag = JSON.parse(readFileSync(flagPath, 'utf8')); } catch { return; }
  if (!flag || !Array.isArray(flag.triggers)) return;

  const { kept, dropped } = pruneTriggers(root, flag, { gitRunner });
  if (dropped.length === 0) return;

  // Silent unless something was actually dropped — and then loud enough to be noticed in
  // the commit output, because a work order disappearing without a word is the same
  // invisibility the flag itself keeps producing.
  out.write(
    `[map-flag] släppte ${dropped.length} spöktrigger (oförändrad mot HEAD, ingen commit ` +
      `sedan ${flag.firstStampedAt}): ${dropped.join(', ')}\n`,
  );

  try {
    if (kept.length === 0) {
      unlinkSync(flagPath);
      out.write('[map-flag] inga triggers kvar — flaggan raderad.\n');
    } else {
      writeFileSync(flagPath, JSON.stringify({ ...flag, triggers: kept }, null, 2) + '\n');
    }
  } catch { /* fail open */ }
}

// Entry-point guard, for the reason BIN-802 recorded: without it, importing anything from
// here runs the CLI — eating the test runner's stdin and exiting the process with no
// output, which reads as vitest hanging rather than as an error.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try { run(); } catch { /* fail open — never block a commit */ }
  process.exit(0);
}
