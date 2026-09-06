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
// This is a FLOOR, not an equality: adding a third script self-test is the desired
// direction and must never fail. The named-file assertions are what make it specific —
// a count alone stays green while one file leaves and another arrives (BIN-823).

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const SELF = 'scripts-self-tests-present.test.mjs';

// The guards that gate the release path today. Both are invoked by deploy.yml as
// build steps; a test file that stops running leaves the guard itself
// unverified, which is how BIN-849's three-month outage stayed invisible.
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
];

// A LITERAL, deliberately not `REQUIRED.length`. Deriving it made this assertion unable
// to fail on its own: deleting a name from REQUIRED lowered the floor in lockstep, so a
// third self-test added and later lost stayed green — the exact silent shrink this file
// replaced BIN-838's MIN=2 to prevent, reproduced inside its own replacement. Growth is
// free at the runner; raising this number is the deliberate act that keeps the new file
// protected, and lowering it is the deliberate act a shrink must perform out loud.
const MIN = 6;

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

test('every named script self-test is still on disk under scripts/', () => {
  for (const name of REQUIRED) {
    assert.ok(
      found.includes(name),
      `${name} is gone from scripts/ — if it moved, move this expectation with it; ` +
        `if it was deleted, the guard it tests is now unverified.`,
    );
  }
});

test('the script self-test set never shrinks below its floor', () => {
  assert.ok(
    found.length >= MIN,
    `only ${found.length} script self-test(s) collected, expected at least ${MIN}. ` +
      `A file left scripts/**/*.test.mjs and took its coverage with it. Growth is fine; ` +
      `a shrink must be a deliberate act that edits this floor.`,
  );
});
