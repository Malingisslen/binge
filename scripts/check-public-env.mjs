#!/usr/bin/env node
/**
 * Every NEXT_PUBLIC_* the client reads must be handed to the production build.
 *
 * Why this exists: `NEXT_PUBLIC_FCM_VAPID_KEY` was read by
 * `src/lib/firebase/messaging.ts` from the day push shipped (May 2026) and was
 * never added to `deploy.yml`'s build env — nor did the GitHub secret exist.
 * Push therefore could not register a single device in production for three
 * months, and nothing said so: these variables are inlined at build time, so a
 * missing one is `undefined` at runtime, not a build error. CI was green, the
 * deploy was green, and the only symptom was a checkbox that refused to tick.
 *
 * The failure is silent by construction, so the guard has to be structural:
 * scan the client source for every `process.env.NEXT_PUBLIC_*` and assert each
 * one appears in the deploy workflow's build `env:` block.
 *
 * This checks WIRING, not values — a secret that is empty or wrong still
 * passes. It closes "nobody remembered the variable", which is the failure that
 * actually happened.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY_WORKFLOW = '.github/workflows/deploy.yml';

/**
 * Set at build time by the workflow itself as literals, never read from a
 * secret — so they are legitimately absent from the secrets-backed lines.
 *
 * Exempt from "must come from a secret", NOT from "must be there at all", and
 * what each one costs if it vanishes differs:
 *  • NEXT_PUBLIC_APP_ENV  — `appCheck.ts` stops warning that App Check is off
 *    in production. (Sentry is unaffected: it defaults to 'production'.)
 *  • NEXT_PUBLIC_GIT_SHA  — every Sentry event's release becomes 'dev', and so
 *    does the React Query cache buster in `Providers.tsx`.
 *
 * The value is carried, not just the name, so the remediation can print the
 * exact line. Printing only the name invites the `${{ secrets.NAME }}` form
 * from the message just below it — and no such secret exists, so it would
 * resolve to an empty string and this linter would go green on the very
 * failure it exists to catch.
 */
const PROVIDED_INLINE = new Map([
  ['NEXT_PUBLIC_APP_ENV', 'production'],
  ['NEXT_PUBLIC_GIT_SHA', '${{ github.sha }}'],
]);

/**
 * Deliberately NOT wired, and wiring them would be the bug.
 *
 * `NEXT_PUBLIC_FIREBASE_USE_EMULATOR` points the app at 127.0.0.1 for
 * Firestore and Functions; shipping it set would send production traffic to a
 * machine that isn't there. Absent is the correct production value, so this is
 * an exemption with a reason, not a hole.
 */
const MUST_NOT_SHIP = new Set(['NEXT_PUBLIC_FIREBASE_USE_EMULATOR']);

/**
 * Every NEXT_PUBLIC_* the source actually READS, i.e. `process.env.NAME`.
 *
 * A bare name match would also catch prose, error strings (`messaging.ts`
 * names the missing key in its own error text) and test fixtures. This linter
 * sits on the only production deploy path with no bypass, so a false positive
 * blocks shipping entirely — a comment naming a variable that was REMOVED
 * would be enough. Requiring the read makes the signal what it claims to be.
 */
export function readVarsFromSource(sourceText) {
  const reads = sourceText.match(/process\.env\.NEXT_PUBLIC_[A-Z0-9_]+/g) ?? [];
  return new Set(reads.map((r) => r.slice('process.env.'.length)));
}

/**
 * Names wired in the workflow's build env as `NAME: ${{ secrets.NAME }}`.
 *
 * The backreference is load-bearing: `NEXT_PUBLIC_FCM_VAPID_KEY: ${{
 * secrets.FCM_VAPID_KEY }}` — a typo, or a rename that touched one side — makes
 * GitHub substitute an empty string, which produces the SAME silent failure
 * this script exists to prevent. Matching only the left-hand name would pass it.
 */
export function readVarsFromWorkflow(workflowText) {
  const wired = new Set();
  for (const line of workflowText.split('\n')) {
    const m = line.match(/^\s*(NEXT_PUBLIC_[A-Z0-9_]+):\s*\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/);
    if (m && m[1] === m[2]) wired.add(m[1]);
  }
  return wired;
}

/**
 * Every NEXT_PUBLIC_* assigned ANYTHING in the workflow, however it is wired.
 *
 * Separate from readVarsFromWorkflow because the two questions differ: "is it
 * wired correctly" (secrets, names matching) vs "is it present at all". A
 * must-never-ship flag pasted as a literal — `NEXT_PUBLIC_FIREBASE_USE_EMULATOR:
 * 'true'` while debugging — is exactly the form that would slip past the
 * stricter reader.
 */
export function readAssignedVars(workflowText) {
  const assigned = new Set();
  for (const line of workflowText.split('\n')) {
    // The trailing \S matters: `NEXT_PUBLIC_X:` with nothing after it assigns
    // an empty string, which is the failure, not the fix.
    const m = line.match(/^\s*(NEXT_PUBLIC_[A-Z0-9_]+):[ \t]*\S/);
    if (m) assigned.add(m[1]);
  }
  return assigned;
}

export function findUnwired(
  sourceVars,
  workflowVars,
  providedInline = PROVIDED_INLINE,
  mustNotShip = MUST_NOT_SHIP,
) {
  return [...sourceVars]
    .filter((v) => !workflowVars.has(v) && !providedInline.has(v) && !mustNotShip.has(v))
    .sort();
}

/**
 * The inverse check: a name on the never-ship list that someone wired anyway.
 * Cheap to run here and the only place that would catch it.
 */
export function findWronglyWired(assignedVars, mustNotShip = MUST_NOT_SHIP) {
  return [...mustNotShip].filter((v) => assignedVars.has(v)).sort();
}

/**
 * The whole verdict, from text alone — no filesystem, no git.
 *
 * Exists so the CHOICE of reader per question is testable: the "is it wired"
 * check reads the strict `NAME: ${{ secrets.NAME }}` form, the "must never
 * ship" check reads any assignment. Wiring both to the strict reader passes
 * every test of the pure functions individually while silently un-catching a
 * literal — so the pairing has to be pinned somewhere, and this is that seam.
 */
export function analyzeWorkflow(sourceVars, workflowText) {
  const assigned = readAssignedVars(workflowText);
  return {
    unwired: findUnwired(sourceVars, readVarsFromWorkflow(workflowText)),
    wronglyWired: findWronglyWired(assigned),
    // PROVIDED_INLINE names are exempt from needing a secret, not from needing
    // to exist. Checked against the looser reader for exactly that reason.
    missingInline: [...PROVIDED_INLINE.keys()]
      .filter((v) => sourceVars.has(v) && !assigned.has(v))
      .sort(),
  };
}

/**
 * The lines to paste back, `NAME: value` — not bare names.
 *
 * Pure so the remedy itself is testable. Printing only the name invites the
 * `${{ secrets.NAME }}` form from the neighbouring message; no such secret
 * exists, so that would set an empty string and this linter would go green on
 * the broken build. The remedy has to carry the literal.
 */
export function inlineRemediationLines(missingInline, providedInline = PROVIDED_INLINE) {
  return missingInline.map((name) => `${name}: ${providedInline.get(name)}`);
}

/** The verdict's exit code. Any non-empty bucket fails. */
export function exitCodeFor({ unwired, wronglyWired, missingInline }) {
  return unwired.length > 0 || wronglyWired.length > 0 || missingInline.length > 0 ? 1 : 0;
}

function collectSourceText() {
  // git grep so the scan follows the repo's own file set (no node_modules, no
  // build output) without hand-rolling a directory walk.
  // Tests are excluded on purpose: a fixture stubbing a fictional
  // NEXT_PUBLIC_* would otherwise demand a production secret and block the
  // only deploy path.
  const out = execFileSync(
    'git',
    [
      'grep', '-h', '-o', '-E', 'process\\.env\\.NEXT_PUBLIC_[A-Z0-9_]+',
      '--', 'src', ':!src/**/*.test.*',
    ],
    { cwd: REPO, encoding: 'utf8' },
  );
  return out;
}

export function main() {
  const sourceVars = readVarsFromSource(collectSourceText());
  const analysis = analyzeWorkflow(
    sourceVars,
    readFileSync(join(REPO, DEPLOY_WORKFLOW), 'utf8'),
  );
  const { unwired, wronglyWired, missingInline } = analysis;

  if (missingInline.length > 0) {
    console.error(
      'public-env linter: these are set as literals by the workflow itself and src/ reads\n' +
        `them, but they are no longer in ${DEPLOY_WORKFLOW}:\n`,
    );
    for (const line of inlineRemediationLines(missingInline)) console.error(`  ${line}`);
    console.error(
      `\nRestore those lines verbatim to the build env in ${DEPLOY_WORKFLOW}. They are\n` +
        'literals, NOT secrets — no such secret exists, so wiring them that way would\n' +
        'set an empty string and this check would go green on the broken build.\n' +
        'See PROVIDED_INLINE in this script for what each one costs when missing.',
    );
  }

  if (wronglyWired.length > 0) {
    console.error(
      'public-env linter: these must NEVER be set in a production build, but are wired in\n' +
        `${DEPLOY_WORKFLOW}:\n`,
    );
    for (const name of wronglyWired) console.error(`  ${name}`);
    console.error('\nRemove them from the build env. See MUST_NOT_SHIP in this script for why.');
  }

  if (unwired.length > 0) {
    console.error(
      `public-env linter: ${unwired.length} variable(s) read by src/ but not passed to the production build.\n`,
    );
    for (const name of unwired) {
      console.error(`  ${name}`);
    }
    console.error(
      `\nAdd each to the build step's env: block in ${DEPLOY_WORKFLOW}:\n` +
        `      ${unwired[0]}: \${{ secrets.${unwired[0]} }}\n\n` +
        'and create the matching GitHub secret (gh secret set <NAME>). Without\n' +
        'both, the value is undefined in the deployed bundle and the feature\n' +
        'fails silently — the build and the deploy both stay green.',
    );
  }

  // All three buckets are reported before exiting, not one per run: this check
  // is cheap and CI shows one failure at a time otherwise.
  const code = exitCodeFor(analysis);
  if (code === 0) {
    console.log(`public-env linter: OK — ${sourceVars.size} NEXT_PUBLIC_* names, all wired for deploy.`);
  }
  return code;
}

// Only run the CLI when invoked directly — importing this file from a test must
// not execute it (BIN-802: a script whose CLI runs at import hangs the runner).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
