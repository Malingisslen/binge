#!/usr/bin/env node
/**
 * A dependency bump may not quietly start running code, or start shipping to
 * users, without someone seeing it (BIN-1088).
 *
 * Why this exists: every reviewer in `.claude/shared-plugin.json`'s `reviewGates`
 * is driven by a PreToolUse hook on a LOCAL `git commit`. Dependabot's weekly
 * bump is merged with GitHub's server-side button, so it never runs one — it
 * passes no review gate and never touches the push gate, and it never could,
 * because the mechanism sits on the other side. Nothing that runs on that path
 * looked at what the bump did to the manifests.
 *
 * WHAT THIS DEFENDS AGAINST: an unwitting or careless bad bump. A manifest that
 * gains an install-time script, promotes a package into the runtime set, or
 * introduces a dependency that was not declared before.
 *
 * WHAT IT DOES NOT DEFEND AGAINST, and the plan says so rather than implying
 * otherwise:
 *   · A transitive `postinstall`. That lives in the lockfile, not here. BIN-939
 *     excluded lock files from review on purpose — a lock diff is a mechanically
 *     resolved graph with no legible intent — and BIN-344 keeps `npm audit`
 *     advisory. This check is the manifest half, deliberately.
 *   · A pull request that edits BOTH this check and the manifest in one commit.
 *     `pull_request` runs the workflow definition from the merge commit, so a
 *     doctored `pr-checks.yml` gates its own payload. That is true of the lint,
 *     typecheck and test steps already; it is not new here.
 *   · The action-pin bumps opened by `.github/dependabot.yml`s `github-actions`
 *     ecosystem. Those change `uses:` pins inside `.github/workflows/` and reach
 *     main by the same server-side merge, and nothing in this check looks at
 *     them. What limits that today is this job holding `contents: read` and no
 *     secrets, not a review.
 *
 * FAIL CLOSED. A check that cannot establish a baseline must go red, never
 * green. An unreachable base ref, a manifest that will not parse, or any other
 * throw exits non-zero. "I could not look" and "I looked and found nothing" are
 * never the same exit code.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Both npm projects in the repo. `functions/` is where this check has the most
 * teeth: the Cloud Functions build installs only `dependencies` before
 * deploying, so a promotion there is the mechanism that puts an install-time
 * script in front of a build holding Firebase Admin credentials. At the root a
 * promotion buys much less — `next build` bundles by import graph, and every
 * `npm ci` call site installs devDependencies anyway — but the signal is the
 * same shape and costs nothing to keep.
 */
export const MANIFESTS = ['package.json', 'functions/package.json'];

/** npm runs each of these itself, without anyone asking, on `npm ci`. */
export const INSTALL_TIME_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Reachability is checked ONCE per ref, separately from reading the files,
 * because the two failures need opposite verdicts and `git show` reports them
 * the same way. A ref we cannot resolve is a broken check (red). A path missing
 * from a ref we CAN resolve is a manifest that does not exist there yet, which
 * is a real and safe state.
 */
export function assertRefReachable(ref, { git = runGit } = {}) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    throw new Error(
      `cannot resolve '${ref}'. The base branch must be fetched before this runs ` +
        `(git fetch --depth=1 origin <base>). Refusing to report a clean diff against ` +
        `a baseline that could not be read.`,
    );
  }
}

/**
 * Presence is decided by a LISTING, never by whether a read threw. A catch around
 * `git show` cannot tell "this ref has no such path" from "the read failed" — a
 * truncated fetch, an unreadable object — and on the head side the second one
 * short-circuits straight to a clean report, which is the fail-open this whole
 * check exists to avoid. `git ls-tree` answers only the presence question: the ref
 * is already known good from `assertRefReachable`, so empty output means the path
 * is genuinely absent and anything else is a throw.
 *
 * Nothing here is caught. A parse error is a finding of its own — a manifest that
 * is not valid JSON — and swallowing it into an empty object would read as
 * "nothing declared".
 */
export function readManifest(ref, path, { git = runGit } = {}) {
  const listed = git(['ls-tree', '--name-only', ref, '--', path]).trim();
  if (listed === '') return { present: false };
  return { present: true, json: JSON.parse(git(['show', `${ref}:${path}`])) };
}

function names(manifest, block) {
  const value = manifest?.[block];
  return new Set(value && typeof value === 'object' ? Object.keys(value) : []);
}

function installScripts(manifest) {
  const scripts = manifest?.scripts;
  if (!scripts || typeof scripts !== 'object') return new Set();
  return new Set(INSTALL_TIME_SCRIPTS.filter((key) => key in scripts));
}

/**
 * A manifest that did not exist at the base is treated as though everything in
 * it is new. That is the loud direction on purpose: a newly added manifest is
 * exactly the case where nobody has looked at its contents before.
 */
export function findingsForManifest(path, before, after) {
  if (!after.present) return [];

  const baseline = before.present ? before.json : {};
  const head = after.json;

  const out = [];

  const hadScripts = before.present ? installScripts(baseline) : new Set();
  for (const key of installScripts(head)) {
    if (!hadScripts.has(key)) {
      out.push({
        manifest: path,
        kind: 'install-script',
        name: key,
        detail: `npm runs "${key}" on every install, including in CI and on the deploy runner.`,
      });
    }
  }

  const hadProd = names(baseline, 'dependencies');
  const hadDev = names(baseline, 'devDependencies');
  for (const name of names(head, 'dependencies')) {
    if (hadProd.has(name)) continue;
    out.push(
      hadDev.has(name)
        ? {
            manifest: path,
            kind: 'dev-to-prod',
            name,
            detail: 'moved out of devDependencies, so it now ships with the runtime install.',
          }
        : {
            manifest: path,
            kind: 'new-dependency',
            name,
            detail: 'declared in neither dependency block before this change.',
          },
    );
  }

  return out;
}

export function findFindings(base, head, { git = runGit, manifests = MANIFESTS } = {}) {
  assertRefReachable(base, { git });
  assertRefReachable(head, { git });

  return manifests.flatMap((path) =>
    findingsForManifest(path, readManifest(base, path, { git }), readManifest(head, path, { git })),
  );
}

export function main(argv, { git = runGit, log = console.log, err = console.error } = {}) {
  const [base, head = 'HEAD'] = argv;
  if (!base) {
    err('usage: check-dependency-diff.mjs <base-ref> [head-ref]');
    return 1;
  }

  let findings;
  try {
    findings = findFindings(base, head, { git });
  } catch (error) {
    // Every throw lands here and every one of them is red. See the fail-closed
    // note in the file header.
    err(`dependency-diff: could not complete the check — ${error.message}`);
    return 1;
  }

  if (findings.length === 0) {
    log(`dependency-diff: OK — no new install-time script, promotion or dependency in ${base}..${head}.`);
    return 0;
  }

  err(`dependency-diff: ${findings.length} change(s) that need a human look before this merges.\n`);
  for (const f of findings) {
    err(`  [${f.kind}] ${f.manifest} → ${f.name}`);
    err(`      ${f.detail}`);
  }
  err(
    '\nA routine version bump never trips this. If the change is intended, say so in\n' +
      'the merge and re-run; this check reports, it does not decide.',
  );
  return 1;
}

// Only run the CLI when invoked directly — importing this file from a test must
// not execute it (BIN-802: a script whose CLI runs at import hangs the runner).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
