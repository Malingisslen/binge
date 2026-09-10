// A floor under the script self-tests, so a shrink cannot go quiet (BIN-850).
//
// Run: npm test
//
// Why this file exists. Until BIN-850 the two guards under `scripts/` were tested by a
// bespoke `Script self-tests` workflow step, and that step carried a
// MIN=2 floor for a specific reason (BIN-838, 405a2fc): `node --test` over a zero-match
// glob exits 0 having run nothing, so without a floor a file that quietly leaves the
// pattern — renamed, moved, excluded — takes its coverage with it and everything stays
// green.
//
// Folding those files into vitest removes that step, and vitest gives no equivalent:
// it only fails when its ENTIRE include set matches nothing, and that set already
// matches hundreds of files across src/, functions/ and docs/org/. A shrink of just
// these two would hide inside the aggregate. That is the exact failure BIN-838 was
// written to close, one layer up, so the floor has to come along with the files.
//
// `found.length >= MIN` is a FLOOR, not an equality: a new script self-test on disk is the
// desired direction and must never fail. The named-file assertions are what make it specific —
// a count alone stays green while one file leaves and another arrives (BIN-823).

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const SELF = 'scripts-self-tests-present.test.mjs';

// The guards under scripts/ whose tests must keep running. A test file that stops running
// leaves the guard itself unverified, which is how BIN-849's three-month outage stayed
// invisible. Which of these deploy.yml actually invokes is derivable —
// `grep -n "node scripts/" .github/workflows/deploy.yml` — and each entry below says what
// it is for, so no count belongs here.
// ADD A NEW SCRIPT SELF-TEST? Add its filename here and raise MIN below. That is the
// whole protection: vitest will run it either way, but nothing notices when it stops
// running unless it is named here.
const REQUIRED = [
  'check-public-env.test.mjs',
  'check-workflow-map.test.mjs',
  // BIN-997. Not a release-path guard like the two above — it is where the knowledge-file
  // COUNT floor gets teeth. The script exits non-zero on a floor failure, but its weekly
  // deploy step is `continue-on-error` by design (the cap is a warning, Malin 2026-08-25),
  // so that exit code is discarded on the one path that runs unattended. Lose this file
  // and the check can measure an empty set forever.
  'check-knowledge-caps.test.mjs',
  // BIN-790. The pre-commit pruner's test. It pins the pruner's never-blocks contract, its
  // keep-on-throw branch and its zero-subprocess cheap path — and the pruner DELETES work
  // orders out of a gitignored flag, so a regression there is invisible to every diff-based
  // gate.
  'prune-map-flag.test.mjs',
  // BIN-1088. The dependency-diff check. It runs on a path into main that no
  // reviewGates reviewer and no push gate reaches — the server-side merge of a
  // dependency bump — so nothing else would notice it going quiet.
  'check-dependency-diff.test.mjs',
  // BIN-613. The First Load JS report's test. The script is not a gate — it reports and
  // can never fail the deploy — but it RUNS on the only path to production, and its
  // never-fails contract is the thing its tests pin. Lose the file and a report that
  // silently measures nothing looks exactly like a report that had nothing to say.
  'bundle-report.test.mjs',
  // BIN-1122. The published-command floor, over the commands an operator pastes during an
  // incident — a restore and a delete are both in that set.
  'check-published-commands.test.mjs',
  // BIN-1137. The rules-test wrapper's test. `npm test` does not run the Firestore
  // rules suite at all, so this wrapper is the only thing asserting that suite ever
  // RAN — a floor that stops measuring is indistinguishable from a healthy run.
  'run-rules-tests.test.mjs',
];

// A LITERAL, deliberately not `REQUIRED.length`. Deriving it made this assertion unable
// to fail on its own: deleting a name from REQUIRED lowered the floor in lockstep, so a
// self-test added and later lost stayed green — the exact silent shrink this file
// replaced BIN-838's floor to prevent, reproduced inside its own replacement. Growth is
// free at the runner; raising this number is the deliberate act that keeps the new file
// protected, and lowering it is the deliberate act a shrink must perform out loud.
const MIN = 8;

// Reads the DISK set, recursively and on both suffixes, to line up as closely as a
// directory read can with what vitest's `scripts/**/*.{test,spec}.mjs` collects. It is not
// the runner's own set, and the gap is worth naming: this floor lives INSIDE the glob it
// guards, so narrowing that include line — or adding these paths to `exclude` — stops
// collecting this file too, and it cannot fail. The step it replaces lived outside, in
// a workflow step, on the path to production. What covers that gap is not this file
// but the commit gate:
// `vitest.*\.config\.ts$` is in binge-test-reviewer's patterns, so a hand narrowing the
// include cannot land it unreviewed. Losses on the DISK side — delete, rename, move — are
// this file's job, and it is measured on those, both ways round:
//   • Without `recursive`, a file moved into a subdirectory drops out of `found`, so the
//     COUNT reports a shortfall that is not real: vitest still collects and runs it. A
//     false alarm on a legitimate reorganisation, which is how a floor gets deleted.
//   • Without `.spec.mjs`, a spec-suffixed sibling the runner does collect is invisible
//     here, so it could be added and later lost without moving this number at all.
// The named check below fires on a move either way — it matches bare filenames — and that
// is deliberate: a move should make someone update REQUIRED, it just should not read as
// lost coverage.
const found = readdirSync(scriptsDir, { recursive: true })
  .map((f) => String(f).replace(/\\/g, '/'))
  .filter((f) => (f.endsWith('.test.mjs') || f.endsWith('.spec.mjs')) && f !== SELF);

// Without this, a name can be removed from REQUIRED and a DUPLICATE of a neighbour put in
// its place: the length still equals MIN, every entry is still on disk, and the file's own
// claim to be a named watch rather than a bare count is silently false. That is the shrink
// this file exists to make loud, reproduced inside it.
test('the named list holds no duplicates', () => {
  assert.equal(new Set(REQUIRED).size, REQUIRED.length);
});

test('every named script self-test is still on disk under scripts/', () => {
  for (const name of REQUIRED) {
    assert.ok(
      found.includes(name),
      `${name} is gone from scripts/ — if it moved, move this expectation with it; ` +
        `if it was deleted, the guard it tests is now unverified.`,
    );
  }
});

// BIN-1105. The `found.length >= MIN` floor counts the DISK and never reads REQUIRED, so a
// name could be deleted from that array with the whole suite green — and the named list is
// what makes this file specific rather than a bare count. Pinning the two to each other is
// an EQUALITY, deliberately not a derivation: `const MIN = REQUIRED.length` sinks in
// lockstep with the list and can therefore never fail, which is the silent shrink this file
// exists to prevent. Disk GROWTH stays free: that floor is untouched.
test('the named list and the floor move together', () => {
  assert.equal(
    REQUIRED.length,
    MIN,
    `REQUIRED names ${REQUIRED.length} self-test(s) but MIN is ${MIN}. Adding a self-test ` +
      `means adding its filename here AND raising MIN; removing one means lowering both. ` +
      `A name removed on its own silently drops the file from the named watch.`,
  );
});

test('the script self-test set never shrinks below its floor', () => {
  assert.ok(
    found.length >= MIN,
    `only ${found.length} script self-test(s) collected, expected at least ${MIN}. ` +
      `A file left scripts/**/*.test.mjs and took its coverage with it. Growth is fine; ` +
      `a shrink must be a deliberate act that edits this floor.`,
  );
});
