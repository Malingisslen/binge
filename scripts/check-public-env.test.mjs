import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readVarsFromSource,
  readVarsFromWorkflow,
  readAssignedVars,
  findUnwired,
  findWronglyWired,
  analyzeWorkflow,
  exitCodeFor,
  inlineRemediationLines,
} from './check-public-env.mjs';

// The case this linter was written for: NEXT_PUBLIC_FCM_VAPID_KEY read by
// src/lib/firebase/messaging.ts, absent from deploy.yml for three months.
test('flags a variable the client reads but the deploy never passes', () => {
  const source = readVarsFromSource(`
    const VAPID_KEY = process.env.NEXT_PUBLIC_FCM_VAPID_KEY;
    const api = process.env.NEXT_PUBLIC_TMDB_API_KEY;
  `);
  const workflow = readVarsFromWorkflow(`
        env:
          NEXT_PUBLIC_TMDB_API_KEY: \${{ secrets.NEXT_PUBLIC_TMDB_API_KEY }}
  `);
  assert.deepEqual(findUnwired(source, workflow), ['NEXT_PUBLIC_FCM_VAPID_KEY']);
});

test('passes once the missing variable is wired', () => {
  const source = readVarsFromSource('process.env.NEXT_PUBLIC_FCM_VAPID_KEY');
  const workflow = readVarsFromWorkflow(
    '          NEXT_PUBLIC_FCM_VAPID_KEY: ${{ secrets.NEXT_PUBLIC_FCM_VAPID_KEY }}',
  );
  assert.deepEqual(findUnwired(source, workflow), []);
});

// A commented-out line is not wiring. Without this the linter would go green on
// the exact half-fix someone reaches for while debugging.
test('a commented-out env line does not count as wired', () => {
  const workflow = readVarsFromWorkflow(
    '          # NEXT_PUBLIC_FCM_VAPID_KEY: ${{ secrets.NEXT_PUBLIC_FCM_VAPID_KEY }}',
  );
  assert.equal(workflow.size, 0);
});

// Only `${{ secrets.X }}` counts — a name mentioned in prose, or used as some
// other key's VALUE, is not wiring. (The readers are line-based, not scoped to
// the build step, so a correct wiring in another job would still count. That is
// a known limit, not a claim this test makes.)
test('a mention that is not a secrets reference does not count as wired', () => {
  const workflow = readVarsFromWorkflow(`
          # remember NEXT_PUBLIC_FCM_VAPID_KEY
          SOMETHING_ELSE: NEXT_PUBLIC_FCM_VAPID_KEY
  `);
  assert.equal(workflow.size, 0);
});

test('workflow-provided literals are not reported as missing secrets', () => {
  const source = readVarsFromSource('process.env.NEXT_PUBLIC_GIT_SHA + process.env.NEXT_PUBLIC_APP_ENV');
  assert.deepEqual(findUnwired(source, new Set()), []);
});

test('the emulator switch is exempt — absent IS its production value', () => {
  const source = readVarsFromSource('process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === "true"');
  assert.deepEqual(findUnwired(source, new Set()), []);
});

// The inverse failure: wiring the emulator switch would point the deployed app
// at 127.0.0.1. Exempt from "must be wired" must not mean unguarded.
test('wiring the emulator switch into the deploy is itself an error', () => {
  const assigned = readAssignedVars(
    '          NEXT_PUBLIC_FIREBASE_USE_EMULATOR: ${{ secrets.NEXT_PUBLIC_FIREBASE_USE_EMULATOR }}',
  );
  assert.deepEqual(findWronglyWired(assigned), ['NEXT_PUBLIC_FIREBASE_USE_EMULATOR']);
});

// The likely way it gets wired is a literal pasted in while debugging, not a
// secret. The strict reader can't see that form, so the inverse check reads a
// looser one.
test('the emulator switch pasted as a literal is caught too', () => {
  const assigned = readAssignedVars("          NEXT_PUBLIC_FIREBASE_USE_EMULATOR: 'true'");
  assert.deepEqual(findWronglyWired(assigned), ['NEXT_PUBLIC_FIREBASE_USE_EMULATOR']);
});

test('a clean workflow reports nothing wrongly wired', () => {
  const assigned = readAssignedVars(
    '          NEXT_PUBLIC_TMDB_API_KEY: ${{ secrets.NEXT_PUBLIC_TMDB_API_KEY }}',
  );
  assert.deepEqual(findWronglyWired(assigned), []);
});

// A mismatched pair — a typo, or a rename that touched one side — makes GitHub
// substitute an empty string. Same silent failure, so it must not count as wired.
test('a name wired to a DIFFERENT secret does not count as wired', () => {
  const workflow = readVarsFromWorkflow(
    '          NEXT_PUBLIC_FCM_VAPID_KEY: ${{ secrets.FCM_VAPID_KEY }}',
  );
  assert.deepEqual([...workflow], []);
});

// Pins the sort. Without a case that produces TWO unwired names, dropping
// .sort() from findUnwired survives every other test in this file.
test('reports every unwired name, in sorted order', () => {
  const source = readVarsFromSource(`
    process.env.NEXT_PUBLIC_ZEBRA;
    process.env.NEXT_PUBLIC_ALPHA;
  `);
  assert.deepEqual(findUnwired(source, new Set()), ['NEXT_PUBLIC_ALPHA', 'NEXT_PUBLIC_ZEBRA']);
});

// analyzeWorkflow pins WHICH reader answers WHICH question. Both checks pass
// their own unit tests no matter how they are wired here, so this is the only
// place the pairing is proven.
test('the never-ship check sees a literal even though the wiring check would not', () => {
  const workflow = "          NEXT_PUBLIC_FIREBASE_USE_EMULATOR: 'true'";
  const { wronglyWired } = analyzeWorkflow(new Set(), workflow);
  assert.deepEqual(wronglyWired, ['NEXT_PUBLIC_FIREBASE_USE_EMULATOR']);
});

test('a correctly wired workflow yields no verdict either way', () => {
  const source = readVarsFromSource('process.env.NEXT_PUBLIC_TMDB_API_KEY');
  const workflow = '          NEXT_PUBLIC_TMDB_API_KEY: ${{ secrets.NEXT_PUBLIC_TMDB_API_KEY }}';
  assert.deepEqual(analyzeWorkflow(source, workflow), {
    unwired: [],
    wronglyWired: [],
    missingInline: [],
  });
});

test('a missing variable and a never-ship variable are reported together', () => {
  const source = readVarsFromSource('process.env.NEXT_PUBLIC_FCM_VAPID_KEY');
  const workflow = "          NEXT_PUBLIC_FIREBASE_USE_EMULATOR: 'true'";
  assert.deepEqual(analyzeWorkflow(source, workflow), {
    unwired: ['NEXT_PUBLIC_FCM_VAPID_KEY'],
    wronglyWired: ['NEXT_PUBLIC_FIREBASE_USE_EMULATOR'],
    missingInline: [],
  });
});

// PROVIDED_INLINE is exempt from needing a SECRET, not from existing. Deleting
// `NEXT_PUBLIC_APP_ENV: production` would otherwise pass while App Check stops
// warning it is off in production and Sentry relabels every event.
test('a workflow-provided literal that disappears from the workflow is caught', () => {
  const source = readVarsFromSource('process.env.NEXT_PUBLIC_APP_ENV');
  const { missingInline, unwired } = analyzeWorkflow(source, '          SOMETHING_ELSE: x');
  assert.deepEqual(missingInline, ['NEXT_PUBLIC_APP_ENV']);
  assert.deepEqual(unwired, []);
});

test('a workflow-provided literal that is present is not reported', () => {
  const source = readVarsFromSource('process.env.NEXT_PUBLIC_APP_ENV');
  const { missingInline } = analyzeWorkflow(source, '          NEXT_PUBLIC_APP_ENV: production');
  assert.deepEqual(missingInline, []);
});

// A key with nothing after the colon assigns an empty string — that IS the
// failure this script exists for, so it must not read as "present".
test('a name with no value does not count as assigned', () => {
  assert.deepEqual([...readAssignedVars('          NEXT_PUBLIC_APP_ENV:')], []);
});

// The exit code is the only thing CI sees. Pin every bucket separately: a
// branch that reports and then returns 0 recreates this script's own incident.
test('exit code is 1 for each failing bucket and 0 only when all are clean', () => {
  const clean = { unwired: [], wronglyWired: [], missingInline: [] };
  assert.equal(exitCodeFor(clean), 0);
  assert.equal(exitCodeFor({ ...clean, unwired: ['NEXT_PUBLIC_X'] }), 1);
  assert.equal(exitCodeFor({ ...clean, wronglyWired: ['NEXT_PUBLIC_Y'] }), 1);
  assert.equal(exitCodeFor({ ...clean, missingInline: ['NEXT_PUBLIC_Z'] }), 1);
});

// The blocking gap round 3 found: analyzeWorkflow's `unwired` half was
// unpinned. Swapping it to the loose reader passed all 18 tests, so a variable
// wired to the WRONG secret read as wired through the exact composed function
// main() calls — this script's own incident, through its own seam.
test('a name wired to the wrong secret is still unwired at the analyze seam', () => {
  const source = readVarsFromSource('process.env.NEXT_PUBLIC_FCM_VAPID_KEY');
  const workflow = '          NEXT_PUBLIC_FCM_VAPID_KEY: ${{ secrets.FCM_VAPID_KEY }}';
  const { unwired } = analyzeWorkflow(source, workflow);
  assert.deepEqual(unwired, ['NEXT_PUBLIC_FCM_VAPID_KEY']);
});

test('a name hardcoded as a literal is still unwired at the analyze seam', () => {
  const source = readVarsFromSource('process.env.NEXT_PUBLIC_FCM_VAPID_KEY');
  const { unwired } = analyzeWorkflow(source, "          NEXT_PUBLIC_FCM_VAPID_KEY: 'BJ_pasted'");
  assert.deepEqual(unwired, ['NEXT_PUBLIC_FCM_VAPID_KEY']);
});

// A name only MENTIONED is not a read. messaging.ts names the missing key in
// its own error string, and this linter blocks the only deploy path — a
// comment naming a removed variable must not stop a release.
test('a name in prose or an error string is not treated as a read', () => {
  const source = readVarsFromSource(`
    throw new Error('Push är inte konfigurerad — NEXT_PUBLIC_FCM_VAPID_KEY saknas.');
    // NEXT_PUBLIC_REMOVED_LONG_AGO was deleted in 2025
  `);
  assert.deepEqual([...source], []);
});

test('a digit in the name survives the scan', () => {
  const source = readVarsFromSource('process.env.NEXT_PUBLIC_OAUTH2_CLIENT');
  assert.deepEqual([...source], ['NEXT_PUBLIC_OAUTH2_CLIENT']);
});

// The remedy is the fix a human will paste. A bare name would be followed by
// the ${{ secrets.NAME }} form from the message above it — no such secret
// exists, so that sets an empty string and this linter goes green on the
// broken build. It has to carry the literal.
test('the remediation carries the literal value, not just the name', () => {
  assert.deepEqual(inlineRemediationLines(['NEXT_PUBLIC_APP_ENV']), [
    'NEXT_PUBLIC_APP_ENV: production',
  ]);
  assert.deepEqual(inlineRemediationLines(['NEXT_PUBLIC_GIT_SHA']), [
    'NEXT_PUBLIC_GIT_SHA: ${{ github.sha }}',
  ]);
});

test('nothing missing means nothing to paste', () => {
  assert.deepEqual(inlineRemediationLines([]), []);
});
