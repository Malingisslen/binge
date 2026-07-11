// Tests for the workflow-map freshness linter's content guards.
//
// Run: node --test scripts/check-workflow-map.test.mjs
//
// Covers check 4 (content FLOOR, BIN-459) and check 5 (content RATCHET,
// BIN-470). These are the anti-silent-loss guards — a feature-revert that keeps
// a flow's shell but strips its prose must fail CI, not pass green. We exercise
// BOTH the fail path (gutted / shrunk / removed) and the pass path (healthy /
// grown), so a future change that neuters the guard is itself caught.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFlowContent,
  checkContentRatchet,
  flowContentLen,
  buildBaseline,
} from './check-workflow-map.mjs';

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
