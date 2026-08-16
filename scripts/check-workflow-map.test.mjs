// Tests for the workflow-map freshness linter's content guards.
//
// Run: npm test (BIN-850 folded this file into the vitest suite; it used to run
// only via a bespoke `node --test` step in ci.yml/deploy.yml, and never locally).
//
// Covers check 4 (content FLOOR, BIN-459) and check 5 (content RATCHET,
// BIN-470). These are the anti-silent-loss guards — a feature-revert that keeps
// a flow's shell but strips its prose must fail CI, not pass green. We exercise
// BOTH the fail path (gutted / shrunk / removed) and the pass path (healthy /
// grown), so a future change that neuters the guard is itself caught.

// Also covers check 3 (COVERAGE cross-check, BIN-789) — the universe → covers[]
// rule that forces every function, route and `boundaries` entry to be
// claimed by a flow. That rule shipped untested and worked partly by accident: the
// reader happened to flatMap every array-valued key, and matching was plain substring
// containment, so a renamed key would have dropped the rule silently and '/feed' could
// be "covered" by an unrelated '/feedback'.

import { test } from 'vitest';
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
  enumerateCrashBoundaries,
  checkBoundaryEnumeration,
  BOUNDARY_EXEMPTIONS,
  MIN_CRASH_BOUNDARIES,
  MIN_EXEMPTION_REASON,
  parseFunctionExports,
  enumerateFunctionExports,
  enumerateRoutes,
  checkFunctionEnumeration,
  checkRouteEnumeration,
  FUNCTION_EXEMPTIONS,
  ROUTE_EXEMPTIONS,
  MIN_FUNCTION_EXPORTS,
  MIN_ROUTES,
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


// ── Check 6 — crash-boundary enumeration (BIN-808) ──────────────────────────────────
//
// The universe used to call `boundaries` wholly hand-curated, so a new src/app/**/error.tsx
// reached no flow and no linter until somebody remembered. Half of that list is walkable,
// and these tests pin BOTH directions: a boundary the universe forgot must fail, and a
// working list must not fail for any other reason.

test('enumeration — the real tree yields every crash boundary, and only those', () => {
  const found = enumerateCrashBoundaries();
  // Every hit is a boundary FILENAME under src/app — never a page, layout or component.
  for (const f of found) {
    assert.match(f, /^src\/app\/(.*\/)?(error|global-error)\.tsx$/, f);
  }
  // The root and one deep dynamic segment, so a walk that stops at depth 1 (or never
  // descends into a [bracket] directory) cannot pass.
  assert.ok(found.includes('src/app/error.tsx'), 'root boundary missing');
  assert.ok(found.includes('src/app/global-error.tsx'), 'global boundary missing');
  assert.ok(found.includes('src/app/movie/[id]/error.tsx'), 'dynamic-segment boundary missing');
  // Deliberately the SAME constant the linter enforces. A separate literal here would be
  // a second answer to one question: deleting two boundary routes would redden the tests
  // while the linter stayed green and said nothing (integration review, 2026-08-14).
  assert.ok(found.length >= MIN_CRASH_BOUNDARIES, `only ${found.length} boundaries walked`);
  // Sorted and de-duplicated: the check compares against a Set, so a duplicate would be
  // invisible there and only show up as a confusing double problem message.
  assert.deepEqual(found, [...new Set(found)].sort());
});

test('enumeration — a boundary the universe forgot is a problem, naming the file', () => {
  const found = ['src/app/error.tsx', 'src/app/brandnew/error.tsx'];
  const problems = [];
  checkBoundaryEnumeration({ boundaries: ['src/app/error.tsx'] }, problems, {
    boundaries: found,
    exemptions: {},
    floor: 0,
  });
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('src/app/brandnew/error.tsx'), problems[0]);
  // The remedy must name BOTH edits — adding it to the universe alone leaves check 3
  // failing next, and a message that mentions only one of them sends the reader back twice.
  assert.ok(problems[0].includes('boundaries[]'), problems[0]);
  assert.ok(problems[0].includes('covers[]'), problems[0]);
});

test('enumeration — an exemption silences that file and nothing else', () => {
  const found = ['src/app/error.tsx', 'src/app/quiet/error.tsx', 'src/app/loud/error.tsx'];
  const problems = [];
  checkBoundaryEnumeration({ boundaries: ['src/app/error.tsx'] }, problems, {
    boundaries: found,
    exemptions: { 'src/app/quiet/error.tsx': 'deliberately silent, see the exemption note' },
    floor: 0,
  });
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('src/app/loud/error.tsx'), problems[0]);
});

test('enumeration — an exemption that no longer matches a real file FAILS instead of rotting', () => {
  // The whole point of the map-with-reasons: permission granted once must not outlive the
  // file it was granted for. A plain array could only ever go quiet here.
  const problems = [];
  checkBoundaryEnumeration({ boundaries: ['src/app/error.tsx'] }, problems, {
    boundaries: ['src/app/error.tsx'],
    exemptions: { 'src/app/deleted/error.tsx': 'was exempt once' },
    floor: 0,
  });
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('src/app/deleted/error.tsx'), problems[0]);
  assert.ok(/delete the exemption/i.test(problems[0]), problems[0]);
});

test('enumeration — an empty walk FAILS on the floor instead of passing vacuously', () => {
  // Without this, `src/app` renamed (or a swallowed readdir error) makes every assertion
  // in the check trivially true — the silent-pass that check 6 exists to remove.
  const problems = [];
  checkBoundaryEnumeration({ boundaries: [] }, problems, { boundaries: [], exemptions: {} });
  assert.equal(problems.length, 1);
  assert.ok(/floor/.test(problems[0]), problems[0]);
  assert.ok(/only 0 file/.test(problems[0]), problems[0]);
});

test('enumeration — the COMMITTED universe already lists every walked boundary', () => {
  // Guards the real data, the same way the coverage test above does: this is what would
  // have caught BIN-808's ten missing files, and what catches the eleventh.
  const universe = JSON.parse(readFileSync(join(ROOT, 'docs/workflow-map-universe.json'), 'utf8'));
  const problems = [];
  const count = checkBoundaryEnumeration(universe, problems);
  assert.deepEqual(problems, [], `universe lost a crash boundary: ${problems.join(' | ')}`);
  assert.ok(count >= MIN_CRASH_BOUNDARIES, `walk found only ${count}`);
  // Empty today, and the test says so out loud: an exemption added later without a
  // reason string is the thing this shape exists to prevent.
  for (const [path, reason] of Object.entries(BOUNDARY_EXEMPTIONS)) {
    assert.equal(typeof reason, 'string', `${path} has no reason`);
    assert.ok(
      reason.length >= MIN_EXEMPTION_REASON,
      `${path}'s reason is not a reason: ${reason}`,
    );
  }
});


test('enumeration — check 6 is actually WIRED INTO main(), not just exported', () => {
  // The other tests all call checkBoundaryEnumeration directly, so deleting its one call
  // site in main() leaves every one of them green while CI stops running the check —
  // "the guard exists" and "the guard runs" are different claims (BIN-776's shape: a
  // precondition that lives in the wrong place fires too late, or never). Source-level
  // because main() reads the real, passing repo and cannot be made to fail from a test.
  const src = readFileSync(join(ROOT, 'scripts/check-workflow-map.mjs'), 'utf8');
  const body = src.slice(src.indexOf('export function main('));
  assert.ok(
    /checkBoundaryEnumeration\(\s*universe\s*,\s*problems\s*\)/.test(body),
    'the call to checkBoundaryEnumeration(universe, problems) is gone from main() — check 6 is dead code',
  );
  // Known blind spot, measured (test review, 2026-08-14): this catches DELETION or
  // rewording of the call, not deletion of its EXECUTION. `if (false) checkBoundary…(…)`
  // and a `// MUTANT: ` prefix on the original line both stay green with NO test failing
  // (a total is not written here on purpose — this file's count moves every round). No cheap
  // execution-based alternative exists — main() reads the real, passing repo and cannot
  // be driven to a failure from here. Written down rather than papered over.
});


test('enumeration — a boundary the universe still lists but the tree no longer has FAILS', () => {
  // The reverse direction, and nothing else covers it: check 3 stays green because the
  // flow still claims the deleted file, and check 1 never sees it (only global-error.tsx
  // and SegmentError.tsx exist as nodes[].path entries). Without this the universe and the
  // map document a file that is gone, indefinitely.
  const problems = [];
  checkBoundaryEnumeration(
    { boundaries: ['src/app/error.tsx', 'src/app/deleted/error.tsx'] },
    problems,
    { boundaries: ['src/app/error.tsx'], exemptions: {}, floor: 0 },
  );
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('src/app/deleted/error.tsx'), problems[0]);
  assert.ok(problems[0].includes('no longer exists'), problems[0]);
});

test('enumeration — the hand-curated half is NOT swept up by the reverse check', () => {
  // THREE shapes, one per way of failing the walk's two-term predicate, because a fixture
  // that fails BOTH terms isolates neither (test review, 2026-08-14: SegmentError.tsx is
  // both wrongly-named AND outside src/app, so with it alone the domain mutant was
  // invisible at 31/31, and the filename term had no fixture at all — deleting that whole
  // line stayed green):
  //   - SegmentError.tsx      — fails both (the real hand-curated entry)
  //   - legacy/error.tsx      — right filename, WRONG domain
  //   - src/app/page.tsx      — right domain, WRONG filename
  // Keying on the filename alone demanded legacy/error.tsx be deleted with a message that
  // is false, because the walk never looked there. The predicate must match the walk.
  const problems = [];
  checkBoundaryEnumeration(
    {
      boundaries: [
        'src/app/error.tsx',
        'src/components/layout/SegmentError.tsx',
        'src/components/legacy/error.tsx',
        'src/app/page.tsx',
      ],
    },
    problems,
    { boundaries: ['src/app/error.tsx'], exemptions: {}, floor: 0 },
  );
  assert.deepEqual(problems, []);
});

test('enumeration — an exemption without a real reason FAILS, map shape alone is not proof', () => {
  // hasOwnProperty silences a path whose value is '' or null just as well as a real
  // reason does, so the argument has to be checked by the LINTER, not only by this file.
  for (const bad of ['', '   ', 'why', null, undefined, 42]) {
    const problems = [];
    checkBoundaryEnumeration({ boundaries: [] }, problems, {
      boundaries: ['src/app/quiet/error.tsx'],
      exemptions: { 'src/app/quiet/error.tsx': bad },
      floor: 0,
    });
    assert.equal(problems.length, 1, `value ${JSON.stringify(bad)} was accepted`);
    assert.ok(/no usable reason/.test(problems[0]), problems[0]);
  }
  // …and a real one is accepted, so the assertion above is not just "everything fails".
  const ok = [];
  checkBoundaryEnumeration({ boundaries: [] }, ok, {
    boundaries: ['src/app/quiet/error.tsx'],
    exemptions: { 'src/app/quiet/error.tsx': 'deliberately silent, see ADR 00XX' },
    floor: 0,
  });
  assert.deepEqual(ok, []);

  // The BOUNDARY case, exactly at the threshold. Without it `<` -> `<=` survives green
  // (test review, 2026-08-14) and a reason of exactly the minimum length is wrongly
  // rejected — the off-by-one no fixture on either side of the gap can see.
  const atFloor = [];
  checkBoundaryEnumeration({ boundaries: [] }, atFloor, {
    boundaries: ['src/app/quiet/error.tsx'],
    exemptions: { 'src/app/quiet/error.tsx': 'x'.repeat(MIN_EXEMPTION_REASON) },
    floor: 0,
  });
  assert.deepEqual(atFloor, [], 'a reason of exactly MIN_EXEMPTION_REASON chars must be accepted');
  // …and one char short must not be.
  const belowFloor = [];
  checkBoundaryEnumeration({ boundaries: [] }, belowFloor, {
    boundaries: ['src/app/quiet/error.tsx'],
    exemptions: { 'src/app/quiet/error.tsx': 'x'.repeat(MIN_EXEMPTION_REASON - 1) },
    floor: 0,
  });
  assert.equal(belowFloor.length, 1);
});

// ── Check 7 — functions & routes are enumerable too (BIN-891) ───────────────────────
//
// The other two universe lists ran on honour until BIN-891 and had ALREADY drifted:
// logRecapMiss, /guider and /calendar/premiarer existed in the tree, were absent from the
// universe, and so required no flow at all — silently falsifying CLAUDE.md's "a new
// function or route requires a map flow". These tests pin both walks, both directions of
// each cross-check, and the fact that the checks are wired into main().

test('function parse — both export shapes count, type/default exports never do', () => {
  // Literal source, not the real file: a parser tested only against today's index.ts
  // passes whenever it happens to agree with today's tree.
  const src = [
    "import { onCall } from 'firebase-functions/v2/https';",
    'export const inlineTrigger = onDocumentCreated(',
    'export async function asyncEntry() {}',
    "export { reExported } from './reExported';",
    "export { localName as publicName } from './aliased';",
    "export { first, second } from './pair';",
    "export type { SomeType } from './types';",
    "export { type OnlyAType, alsoReal } from './mixed';",
    'export default somethingElse;',
    "export * from './star';",
    '  export const indented = 1;',
    "// export const commentedOut = onSchedule('every 24 hours');",
  ].join('\n');
  assert.deepEqual(parseFunctionExports(src), [
    'alsoReal',
    'asyncEntry',
    'first',
    'indented',
    'inlineTrigger',
    'publicName',
    'reExported',
    'second',
  ]);
});

test('function parse — an empty or unparsable file yields nothing (the floor then speaks)', () => {
  assert.deepEqual(parseFunctionExports(''), []);
  assert.deepEqual(parseFunctionExports('const notExported = 1;\nexport default x;'), []);
});

test('function walk — the real entry point yields every deployed export, sorted and unique', () => {
  const found = enumerateFunctionExports();
  // One of each export shape, so a parser that handles only one cannot pass.
  assert.ok(found.includes('onFriendRequestCreate'), 'inline `export const` trigger missing');
  assert.ok(found.includes('retentionCleanup'), '`export { x } from` re-export missing');
  // The export BIN-891 was filed about: it was in the tree and outside the universe.
  assert.ok(found.includes('logRecapMiss'), 'logRecapMiss missing — the drift this check exists for');
  assert.ok(found.length >= MIN_FUNCTION_EXPORTS, `only ${found.length} exports parsed`);
  assert.deepEqual(found, [...new Set(found)].sort());
});

test('route walk — the real tree yields URL paths, root included, brackets kept', () => {
  const found = enumerateRoutes();
  for (const r of found) assert.ok(r.startsWith('/'), `not a URL path: ${r}`);
  assert.ok(found.includes('/'), 'the root route is missing — src/app/page.tsx maps to /');
  assert.ok(found.includes('/movie/[id]'), 'a dynamic segment must keep its brackets');
  assert.ok(found.includes('/my/films'), 'a nested route is missing');
  // Both routes BIN-891 was filed about, one of them two levels deep.
  assert.ok(found.includes('/guider'), '/guider missing — the drift this check exists for');
  assert.ok(found.includes('/calendar/premiarer'), '/calendar/premiarer missing');
  assert.ok(found.length >= MIN_ROUTES, `only ${found.length} routes walked`);
  assert.deepEqual(found, [...new Set(found)].sort());
});

test('function enumeration — an export the universe forgot is a problem, naming both edits', () => {
  const problems = [];
  checkFunctionEnumeration({ functions: ['retentionCleanup'] }, problems, {
    functions: ['retentionCleanup', 'brandNewNotify'],
    exemptions: {},
    floor: 0,
  });
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('brandNewNotify'), problems[0]);
  assert.ok(problems[0].includes('functions[]'), problems[0]);
  assert.ok(problems[0].includes('covers[]'), problems[0]);
});

test('route enumeration — a route the universe forgot is a problem, naming both edits', () => {
  const problems = [];
  checkRouteEnumeration({ routes: ['/feed'] }, problems, {
    routes: ['/feed', '/brandnew'],
    exemptions: {},
    floor: 0,
  });
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('/brandnew'), problems[0]);
  assert.ok(problems[0].includes('routes[]'), problems[0]);
  assert.ok(problems[0].includes('covers[]'), problems[0]);
});

test('check 7 — the REVERSE direction: listed but gone from the tree FAILS, both lists', () => {
  // Same hole check 6 closed for boundaries: check 3 stays green because a flow still
  // claims the deleted thing, so nothing else would ever notice a removed function or page.
  const fnProblems = [];
  checkFunctionEnumeration({ functions: ['retentionCleanup', 'deletedNotify'] }, fnProblems, {
    functions: ['retentionCleanup'],
    exemptions: {},
    floor: 0,
  });
  assert.equal(fnProblems.length, 1);
  assert.ok(fnProblems[0].includes('deletedNotify'), fnProblems[0]);
  assert.ok(fnProblems[0].includes('no longer exports'), fnProblems[0]);

  const routeProblems = [];
  checkRouteEnumeration({ routes: ['/feed', '/removed'] }, routeProblems, {
    routes: ['/feed'],
    exemptions: {},
    floor: 0,
  });
  assert.equal(routeProblems.length, 1);
  assert.ok(routeProblems[0].includes('/removed'), routeProblems[0]);
  assert.ok(routeProblems[0].includes('no longer has'), routeProblems[0]);
});

test('check 7 — the reverse check only claims what its own walk could have produced', () => {
  // The BIN-808 lesson carried forward: a predicate looser than the walk demands deletion
  // with a message that is false. Neither list can contain what the other walks, and
  // neither walk can produce a boundary path — so those entries are left to check 3.
  const fnProblems = [];
  checkFunctionEnumeration(
    { functions: ['retentionCleanup', 'src/components/layout/SegmentError.tsx', '/feed'] },
    fnProblems,
    { functions: ['retentionCleanup'], exemptions: {}, floor: 0 },
  );
  assert.deepEqual(fnProblems, []);

  const routeProblems = [];
  checkRouteEnumeration(
    { routes: ['/feed', 'retentionCleanup', 'src/app/global-error.tsx'] },
    routeProblems,
    { routes: ['/feed'], exemptions: {}, floor: 0 },
  );
  assert.deepEqual(routeProblems, []);
});

test('check 7 — an exemption silences that entry and nothing else, on both lists', () => {
  const fnProblems = [];
  checkFunctionEnumeration({ functions: [] }, fnProblems, {
    functions: ['quietOne', 'loudOne'],
    exemptions: { quietOne: 'deliberately undocumented, see the exemption note' },
    floor: 0,
  });
  assert.equal(fnProblems.length, 1);
  assert.ok(fnProblems[0].includes('loudOne'), fnProblems[0]);

  const routeProblems = [];
  checkRouteEnumeration({ routes: [] }, routeProblems, {
    routes: ['/quiet', '/loud'],
    exemptions: { '/quiet': 'deliberately undocumented, see the exemption note' },
    floor: 0,
  });
  assert.equal(routeProblems.length, 1);
  assert.ok(routeProblems[0].includes('/loud'), routeProblems[0]);
});

test('check 7 — an exemption that no longer matches the tree FAILS instead of rotting', () => {
  const fnProblems = [];
  checkFunctionEnumeration({ functions: ['stillHere'] }, fnProblems, {
    functions: ['stillHere'],
    exemptions: { goneNotify: 'was exempt once, long ago' },
    floor: 0,
  });
  assert.equal(fnProblems.length, 1);
  assert.ok(fnProblems[0].includes('goneNotify'), fnProblems[0]);
  assert.ok(/delete the exemption/i.test(fnProblems[0]), fnProblems[0]);

  const routeProblems = [];
  checkRouteEnumeration({ routes: ['/still'] }, routeProblems, {
    routes: ['/still'],
    exemptions: { '/gone': 'was exempt once, long ago' },
    floor: 0,
  });
  assert.equal(routeProblems.length, 1);
  assert.ok(routeProblems[0].includes('/gone'), routeProblems[0]);
  assert.ok(/delete the exemption/i.test(routeProblems[0]), routeProblems[0]);
});

test('check 7 — an exemption without a real reason FAILS, on both lists', () => {
  // The linter enforces the argument, not just the test file: hasOwnProperty silences a
  // key whose value is '' or null exactly as well as a real reason does.
  for (const bad of ['', '   ', 'why', null, undefined, 42]) {
    const fnProblems = [];
    checkFunctionEnumeration({ functions: [] }, fnProblems, {
      functions: ['quietOne'],
      exemptions: { quietOne: bad },
      floor: 0,
    });
    assert.equal(fnProblems.length, 1, `value ${JSON.stringify(bad)} was accepted`);
    assert.ok(/no usable reason/.test(fnProblems[0]), fnProblems[0]);

    const routeProblems = [];
    checkRouteEnumeration({ routes: [] }, routeProblems, {
      routes: ['/quiet'],
      exemptions: { '/quiet': bad },
      floor: 0,
    });
    assert.equal(routeProblems.length, 1, `value ${JSON.stringify(bad)} was accepted`);
    assert.ok(/no usable reason/.test(routeProblems[0]), routeProblems[0]);
  }
  // Exactly at the threshold on both sides, or `<` -> `<=` survives (the off-by-one no
  // fixture on either side of the gap can see).
  const atFloor = [];
  checkFunctionEnumeration({ functions: [] }, atFloor, {
    functions: ['quietOne'],
    exemptions: { quietOne: 'x'.repeat(MIN_EXEMPTION_REASON) },
    floor: 0,
  });
  assert.deepEqual(atFloor, [], 'a reason of exactly MIN_EXEMPTION_REASON chars must be accepted');
  const belowFloor = [];
  checkRouteEnumeration({ routes: [] }, belowFloor, {
    routes: ['/quiet'],
    exemptions: { '/quiet': 'x'.repeat(MIN_EXEMPTION_REASON - 1) },
    floor: 0,
  });
  assert.equal(belowFloor.length, 1);
});

test('check 7 — an empty walk FAILS on its floor instead of passing vacuously', () => {
  // functions/src/index.ts renamed, or src/app moved: every other assertion in the check
  // goes trivially true. Called with NO floor override, so it is the shipped constant.
  const fnProblems = [];
  checkFunctionEnumeration({ functions: [] }, fnProblems, { functions: [], exemptions: {} });
  assert.equal(fnProblems.length, 1);
  assert.ok(/floor/.test(fnProblems[0]) && /only 0 export/.test(fnProblems[0]), fnProblems[0]);

  const routeProblems = [];
  checkRouteEnumeration({ routes: [] }, routeProblems, { routes: [], exemptions: {} });
  assert.equal(routeProblems.length, 1);
  assert.ok(/floor/.test(routeProblems[0]) && /only 0 page\.tsx/.test(routeProblems[0]), routeProblems[0]);
});

test('check 7 — the COMMITTED universe already lists every walked function and route', () => {
  // Guards the real data. This is what would have caught BIN-891's three drifted entries,
  // and what catches the fourth.
  const universe = JSON.parse(readFileSync(join(ROOT, 'docs/workflow-map-universe.json'), 'utf8'));

  const fnProblems = [];
  const fnCount = checkFunctionEnumeration(universe, fnProblems);
  assert.deepEqual(fnProblems, [], `universe lost a Cloud Function: ${fnProblems.join(' | ')}`);
  assert.ok(fnCount >= MIN_FUNCTION_EXPORTS, `walk parsed only ${fnCount}`);

  const routeProblems = [];
  const routeCount = checkRouteEnumeration(universe, routeProblems);
  assert.deepEqual(routeProblems, [], `universe lost a route: ${routeProblems.join(' | ')}`);
  assert.ok(routeCount >= MIN_ROUTES, `walk found only ${routeCount}`);

  // Both exemption maps are empty today, and the test says so out loud: an exemption added
  // later without a reason string is exactly what this shape exists to prevent.
  for (const [name, map] of [['FUNCTION_EXEMPTIONS', FUNCTION_EXEMPTIONS], ['ROUTE_EXEMPTIONS', ROUTE_EXEMPTIONS]]) {
    for (const [entry, reason] of Object.entries(map)) {
      assert.equal(typeof reason, 'string', `${name}['${entry}'] has no reason`);
      assert.ok(reason.length >= MIN_EXEMPTION_REASON, `${name}['${entry}']'s reason is not a reason: ${reason}`);
    }
  }
});

test('check 7 — both new checks are actually WIRED INTO main(), not just exported', () => {
  // Same blind spot, and the same reason, as the check-6 wiring test above: these tests
  // call the checks directly, so deleting their call sites in main() leaves every one of
  // them green while CI stops running them. Source-level because main() reads the real,
  // passing repo and cannot be driven to a failure from here.
  const src = readFileSync(join(ROOT, 'scripts/check-workflow-map.mjs'), 'utf8');
  const body = src.slice(src.indexOf('export function main('));
  assert.ok(
    /checkFunctionEnumeration\(\s*universe\s*,\s*problems\s*\)/.test(body),
    'the call to checkFunctionEnumeration(universe, problems) is gone from main() — check 7 is half dead code',
  );
  assert.ok(
    /checkRouteEnumeration\(\s*universe\s*,\s*problems\s*\)/.test(body),
    'the call to checkRouteEnumeration(universe, problems) is gone from main() — check 7 is half dead code',
  );
});

test('check 7 — the three BIN-891 entries are in the universe AND claimed by a flow', () => {
  // The ticket's own acceptance: enumeration alone would only have made CI red. Each of the
  // three must ALSO be documented, or the map still does not say what leaves the device.
  const universe = JSON.parse(readFileSync(join(ROOT, 'docs/workflow-map-universe.json'), 'utf8'));
  const data = extractDataJson(readFileSync(join(ROOT, 'docs/workflow-map.html'), 'utf8'));
  const claims = new Set();
  for (const action of data.actions || []) for (const c of action.covers || []) claims.add(c);
  for (const entry of ['logRecapMiss', '/guider', '/calendar/premiarer']) {
    assert.ok(
      universe.functions.includes(entry) || universe.routes.includes(entry),
      `${entry} is missing from the universe again`,
    );
    assert.ok([...claims].some((c) => coversEntry(c, entry)), `${entry} is claimed by no flow`);
  }
});

test('coverage — no single covers[] token stands in for more than one boundary', () => {
  // The load-bearing half of BIN-808's choice, and it was pinned nowhere. `coversEntry`
  // accepts a whole-segment TAIL, so ONE claim of 'error.tsx' tail-matches ten of the
  // eleven boundaries. Collapsing the ten explicit tokens into that one would keep
  // coverage 73/73 green today while making check 3 vacuous for every boundary added
  // afterwards — the committed-data test asserts covered === universeSize, which the
  // collapse satisfies. Assert per-file claiming instead of per-file coverage.
  const universe = JSON.parse(readFileSync(join(ROOT, 'docs/workflow-map-universe.json'), 'utf8'));
  const data = extractDataJson(readFileSync(join(ROOT, 'docs/workflow-map.html'), 'utf8'));
  const claims = new Set();
  for (const action of data.actions || []) for (const c of action.covers || []) claims.add(c);
  for (const claim of claims) {
    const hits = universe.boundaries.filter((b) => coversEntry(claim, b));
    assert.ok(
      hits.length <= 1,
      `covers[] token '${claim}' stands in for ${hits.length} boundaries (${hits.join(', ')}) — claim each one explicitly, or check 3 goes vacuous for the next boundary added`,
    );
  }
  // And every boundary is claimed by SOMETHING, so the loop above cannot pass by there
  // being no claims at all.
  for (const b of universe.boundaries) {
    assert.ok([...claims].some((c) => coversEntry(c, b)), `boundary '${b}' is claimed by no flow`);
  }
});
