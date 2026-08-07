// Tests for the workflow-map freshness linter's content guards.
//
// Run: node --test scripts/check-workflow-map.test.mjs
//
// Covers check 4 (content FLOOR, BIN-459) and check 5 (content RATCHET,
// BIN-470). These are the anti-silent-loss guards — a feature-revert that keeps
// a flow's shell but strips its prose must fail CI, not pass green. We exercise
// BOTH the fail path (gutted / shrunk / removed) and the pass path (healthy /
// grown), so a future change that neuters the guard is itself caught.

// Also covers check 3 (COVERAGE cross-check, BIN-789) — the universe → covers[]
// rule that forces every function, route and hand-curated `boundaries` entry to be
// claimed by a flow. That rule shipped untested and worked partly by accident: the
// reader happened to flatMap every array-valued key, and matching was plain substring
// containment, so a renamed key would have dropped the rule silently and '/feed' could
// be "covered" by an unrelated '/feedback'.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkFlowContent,
  checkContentRatchet,
  flowContentLen,
  buildBaseline,
  checkCoverage,
  coversEntry,
  universeEntries,
  extractDataJson,
} from './check-workflow-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A substantive, realistic flow — clears every floor (label >= 3, desc >= 80,
// every payload >= 8, total >= 150, at least one step).
function healthyFlow(id = 'flow-x') {
  return {
    id,
    label: 'Healthy example flow',
    description:
      'A daily scheduled job scans the collection, diffs against a per-title marker, ' +
      'and notifies each qualifying recipient exactly once — first observation only sets the baseline.',
    steps: [
      { from: 'cf-x', to: 'firestore', payload: 'collectionGroup scan narrowed via select(), grouped by tmdbId' },
      { from: 'cf-x', to: 'cf-sendPush', payload: 'sendPushToUser(uid, {title, body, actionUrl, tag}, {pushEnabled})' },
    ],
  };
}

// A flow gutted down to a stub — the exact shape a bad revert leaves behind.
function guttedFlow(id = 'flow-y') {
  return { id, label: '', description: '', steps: [] };
}

test('flowContentLen sums trimmed description + step payload lengths', () => {
  const flow = {
    description: '  abcde  ', // trims to 5
    steps: [{ payload: '123' }, { payload: '  67  ' }], // 3 + 2
  };
  assert.equal(flowContentLen(flow), 10);
});

test('flowContentLen tolerates missing fields', () => {
  assert.equal(flowContentLen({}), 0);
  assert.equal(flowContentLen({ description: 'hi', steps: null }), 2);
});

test('checkFlowContent — pass path: a healthy flow yields no problems', () => {
  const problems = [];
  checkFlowContent([healthyFlow()], problems);
  assert.deepEqual(problems, []);
});

test('checkFlowContent — fail path: a gutted flow trips every floor', () => {
  const problems = [];
  checkFlowContent([guttedFlow('flow-y')], problems);
  // Expect distinct problems: thin label, thin description, no steps, thin total.
  assert.ok(problems.length >= 4, `expected >=4 problems, got ${problems.length}: ${problems.join(' | ')}`);
  assert.ok(problems.some((p) => p.includes('label')), 'missing label problem');
  assert.ok(problems.some((p) => p.includes('description too thin')), 'missing description problem');
  assert.ok(problems.some((p) => p.includes('no steps')), 'missing no-steps problem');
  assert.ok(problems.some((p) => p.includes('total prose too thin')), 'missing total-prose problem');
  assert.ok(problems.every((p) => p.includes("flow 'flow-y'")), 'every problem names the flow id');
});

test('checkFlowContent — fail path: a single thin step payload is flagged', () => {
  const flow = healthyFlow();
  flow.steps[1].payload = 'tiny'; // 4 < MIN_STEP_PAYLOAD (8)
  const problems = [];
  checkFlowContent([flow], problems);
  assert.ok(problems.some((p) => p.includes('step 2') && p.includes('thin payload')), problems.join(' | '));
});

test('checkContentRatchet — pass path: content >= baseline yields no problems', () => {
  const flow = healthyFlow('flow-x');
  const baseline = { flows: { 'flow-x': flowContentLen(flow) } };
  const problems = [];
  checkContentRatchet([flow], baseline, problems);
  assert.deepEqual(problems, []);
});

test('checkContentRatchet — pass path: content grown above baseline is fine', () => {
  const flow = healthyFlow('flow-x');
  const baseline = { flows: { 'flow-x': flowContentLen(flow) - 100 } };
  const problems = [];
  checkContentRatchet([flow], baseline, problems);
  assert.deepEqual(problems, []);
});

test('checkContentRatchet — fail path: prose shrank below baseline', () => {
  const flow = healthyFlow('flow-x');
  const baseline = { flows: { 'flow-x': flowContentLen(flow) + 500 } };
  const problems = [];
  checkContentRatchet([flow], baseline, problems);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('prose shrank'), problems[0]);
  assert.ok(problems[0].includes("flow 'flow-x'"), problems[0]);
});

test('checkContentRatchet — fail path: a baselined flow removed from the map', () => {
  const baseline = { flows: { 'flow-gone': 900 } };
  const problems = [];
  checkContentRatchet([healthyFlow('flow-x')], baseline, problems);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('missing from the map'), problems[0]);
  assert.ok(problems[0].includes("flow 'flow-gone'"), problems[0]);
});

test('checkContentRatchet — no baseline (or empty) is a no-op, not a crash', () => {
  const problems = [];
  checkContentRatchet([healthyFlow()], null, problems);
  checkContentRatchet([healthyFlow()], {}, problems);
  checkContentRatchet([healthyFlow()], { flows: {} }, problems);
  assert.deepEqual(problems, []);
});

// ── Check 3 — coverage cross-check (BIN-789) ────────────────────────────────────────

// A universe shaped like the committed one: enumerable keys plus the hand-curated
// `boundaries` list added by b238ead for files that transmit data off-device while
// being neither a route nor a function (BIN-760/780).
function universeFixture(overrides = {}) {
  return {
    comment: 'prose about how to regenerate this file — must never be treated as an entry',
    functions: ['retentionCleanup'],
    routes: ['/', '/feed'],
    boundaries: ['src/app/global-error.tsx', 'src/components/layout/SegmentError.tsx'],
    ...overrides,
  };
}

function flowsClaiming(...covers) {
  return [{ id: 'flow-cov', label: 'Covering flow', covers }];
}

test('universeEntries: every array-valued key counts, comment prose never does', () => {
  const entries = universeEntries(universeFixture());
  assert.equal(entries.has('src/app/global-error.tsx'), true);
  assert.equal(entries.has('retentionCleanup'), true);
  assert.equal(entries.size, 5);
  assert.ok(![...entries].some((e) => e.includes('regenerate')), 'comment leaked into the entry set');
});

test('coverage — fail path: an uncovered boundaries entry fails the linter', () => {
  const problems = [];
  const { covered, universeSize } = checkCoverage(
    universeFixture(),
    flowsClaiming('retentionCleanup', '/', '/feed', 'src/components/layout/SegmentError.tsx'),
    problems,
  );
  assert.equal(universeSize, 5);
  assert.equal(covered, 4);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('src/app/global-error.tsx'), problems[0]);
  assert.ok(problems[0].includes('covers[]'), problems[0]);
});

test('coverage — the rule survives renaming the key: it is keyed on shape, not on "boundaries"', () => {
  const renamed = universeFixture({ boundaries: undefined, clientBoundaries: ['src/app/global-error.tsx'] });
  delete renamed.boundaries;
  const problems = [];
  const { universeSize } = checkCoverage(renamed, flowsClaiming('retentionCleanup', '/', '/feed'), problems);
  assert.equal(universeSize, 4);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('src/app/global-error.tsx'), problems[0]);
});

test('coverage — pass path: a covers[] token naming a path SEGMENT covers the full entry', () => {
  const problems = [];
  const { covered, universeSize } = checkCoverage(
    universeFixture(),
    // how the real map claims these: the bare filename, and a dynamic-route variant
    flowsClaiming('retentionCleanup', '/', '/feed', 'global-error.tsx', 'src/components/layout/SegmentError.tsx'),
    problems,
  );
  assert.deepEqual(problems, []);
  assert.equal(covered, universeSize);
});

test('coversEntry — fuzzy matching cannot OVER-match: a neighbour never covers an entry', () => {
  // The old plain-substring rule counted every one of these as covered.
  assert.equal(coversEntry('/feedback', '/feed'), false);
  assert.equal(coversEntry('/feed-me', '/feed'), false);
  assert.equal(coversEntry('src/lib/stats/aggregate.ts', '/stats'), false);
  assert.equal(coversEntry('onFriendRequestCreate-delivery', 'onFriendRequestCreate'), false);
  assert.equal(coversEntry('global-error.tsx.bak', 'src/app/global-error.tsx'), false);
  // and still matches what it must
  assert.equal(coversEntry('global-error.tsx', 'src/app/global-error.tsx'), true);
  assert.equal(coversEntry('/feed', '/feed'), true);
  assert.equal(coversEntry('src/app/[locale]/feed/page.tsx', 'src/app'), false);
});

test('coversEntry — a claim only matches as a whole-segment TAIL, never a prefix or middle', () => {
  // A directory-shaped claim must not swallow everything beneath it: one flow saying
  // 'src/app' would otherwise document the entire route tree by itself.
  assert.equal(coversEntry('src/app', 'src/app/global-error.tsx'), false);
  assert.equal(coversEntry('src/lib', 'src/lib/tmdb/client.ts'), false);
  assert.equal(coversEntry('/grupp', '/grupp/[id]/tillsammans'), false);
  // ...nor may it match in the middle of a path.
  assert.equal(coversEntry('layout', 'src/components/layout/SegmentError.tsx'), false);
  assert.equal(coversEntry('recommendations', 'src/lib/recommendations/cascadePrioritizer.ts'), false);
  // The tail direction is the one that still works.
  assert.equal(coversEntry('layout/SegmentError.tsx', 'src/components/layout/SegmentError.tsx'), true);
});

test('coversEntry — short tokens (the root route) only ever match exactly', () => {
  assert.equal(coversEntry('/', '/'), true);
  assert.equal(coversEntry('/my/films', '/'), false);
  assert.equal(coversEntry('/', '/my/films'), false);
  assert.equal(coversEntry(undefined, '/feed'), false);
  assert.equal(coversEntry('/feed', null), false);
});

test('coverage — an over-matching neighbour cannot hide a real hole', () => {
  const problems = [];
  checkCoverage(
    { routes: ['/feed'] },
    flowsClaiming('/feedback'), // plausible-looking, unrelated flow
    problems,
  );
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes("'/feed'"), problems[0]);
});

test('coverage — the COMMITTED universe and map are fully covered (guards the real data)', () => {
  const universe = JSON.parse(readFileSync(join(ROOT, 'docs/workflow-map-universe.json'), 'utf8'));
  const data = extractDataJson(readFileSync(join(ROOT, 'docs/workflow-map.html'), 'utf8'));
  const problems = [];
  const { covered, universeSize } = checkCoverage(universe, data.actions || [], problems);
  assert.deepEqual(problems, [], `committed map lost coverage: ${problems.join(' | ')}`);
  assert.equal(covered, universeSize);
  // the boundaries list is real and enforced, not an empty formality
  assert.ok(universe.boundaries.length >= 2, 'boundaries list emptied — BIN-760/780 guard removed');
});

test('buildBaseline produces a keyed content map + a regeneration comment', () => {
  const baseline = buildBaseline([healthyFlow('flow-a'), healthyFlow('flow-b')]);
  assert.equal(typeof baseline.comment, 'string');
  assert.ok(baseline.comment.includes('--update-baseline'));
  assert.deepEqual(Object.keys(baseline.flows).sort(), ['flow-a', 'flow-b']);
  assert.equal(baseline.flows['flow-a'], flowContentLen(healthyFlow('flow-a')));
  // Round-trips: a freshly-built baseline must pass its own ratchet.
  const problems = [];
  checkContentRatchet([healthyFlow('flow-a'), healthyFlow('flow-b')], baseline, problems);
  assert.deepEqual(problems, []);
});
