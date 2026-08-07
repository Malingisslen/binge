#!/usr/bin/env node
// check-workflow-map.mjs — workflow-map freshness linter (CI + local).
//
// The interactive workflow map (docs/workflow-map.html) is data-driven: its
// embedded <script id="data"> JSON lists every component with a repo path, and
// every flow step references component ids. This linter keeps the map honest
// mechanically:
//   1. every node path that looks like a repo path must exist (glob tokens
//      must match >=1 entry) — catches renames/deletions;
//   2. every flow step's from/to must reference an existing node id;
//   3. COVERAGE: every entry in docs/workflow-map-universe.json (functions/
//      routes/boundaries/…) must be claimed by at least one flow's covers[] —
//      a new function, route or off-device-transmitting boundary without a
//      mapped flow fails CI. Key-agnostic (every array-valued key but
//      "comment" counts) and segment-boundary matched, both pinned by
//      scripts/check-workflow-map.test.mjs (BIN-789).
//   4. CONTENT FLOOR: every flow must carry substantive prose — a label, a
//      real description, at least one step, and a non-empty payload on every
//      step. This is the anti-silent-loss guard (BIN-459): coverage (check 3)
//      only asserts a flow EXISTS and still names its covers[], so a
//      feature-revert that keeps the flow shell but strips its description /
//      steps / payloads down to a stub used to pass green. The floors are set
//      below the current data's minimums, so a flow gutted of its prose now
//      trips CI instead of vanishing silently.
//   5. CONTENT RATCHET (BIN-470, successor to BIN-459): the absolute floor in
//      check 4 only catches a flow gutted below ~150 chars — it says nothing
//      about a flow that is thinned from 900 chars to 200 (a big net prose loss
//      that still clears the floor). So we also commit a per-flow content
//      baseline (docs/workflow-map-content-baseline.json: flow id → current
//      description+payload char count) and diff every flow's live content
//      against it: shrink below the baseline, or drop a baselined flow entirely,
//      fails CI. This catches the exact partial-thinning a feature-revert bundle
//      could sneak past the floor. When a reduction is intentional (a flow was
//      legitimately made more concise, or genuinely removed), regenerate the
//      baseline with `node scripts/check-workflow-map.mjs --update-baseline` and
//      commit it — the ratchet forces that to be a conscious, reviewable step.
// Semantic drift (behavior changed inside a still-existing file) is handled by
// .claude/hooks/map-freshness.mjs + .claude/state/workflow-map-stale.json.
//
// Usage: node scripts/check-workflow-map.mjs                    (lint; exit 1 on a problem list)
//        node scripts/check-workflow-map.mjs --update-baseline  (regenerate the content baseline)

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_FILE = 'docs/workflow-map.html';
const BASELINE_FILE = 'docs/workflow-map-content-baseline.json';
const REPO_ROOTS = ['src/', 'functions/', 'extension/', 'public/', 'docs/', 'shared/', 'scripts/'];
const ROOT_FILES = ['firestore.rules', 'firebase.json'];

// Content-floor thresholds (check 4). Deliberately set BELOW the current data's
// minimums so no existing flow trips — they catch a flow whose prose has been
// GUTTED (blanked/stubbed), not concise-but-real flows. Current minimums as of
// 2026-07-11: shortest description 145 chars, shortest step payload 16 chars,
// smallest desc+payload total 277 chars, fewest steps 2. Raising these floors is
// fine when the data's floor rises; never raise one above the real minimum or a
// legitimate flow starts failing.
const MIN_FLOW_LABEL = 3; // a real label, not '' or a single char
const MIN_FLOW_DESC = 80; // a real sentence of prose, not a stub
const MIN_STEP_PAYLOAD = 8; // a step must say what it carries
const MIN_FLOW_CONTENT = 150; // description + all step payloads, combined

export function extractDataJson(html) {
  const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no <script id="data"> block found');
  return JSON.parse(m[1]);
}

// A flow's "content" for the floor (check 4) and the ratchet (check 5): the
// trimmed description length plus every step's trimmed payload length. This is
// the prose a feature-revert would strip; label/step-count are guarded
// separately in checkFlowContent.
export function flowContentLen(action) {
  const desc = String(action?.description ?? '').trim().length;
  const steps = Array.isArray(action?.steps) ? action.steps : [];
  return desc + steps.reduce((n, s) => n + String(s?.payload ?? '').trim().length, 0);
}

function checkableTokens(pathField) {
  return String(pathField)
    .split(',')
    .map((t) => t.trim().replace(/:\d+(-\d+)?$/, ''))
    .filter((t) => REPO_ROOTS.some((r) => t.startsWith(r)) || ROOT_FILES.includes(t));
}

// Globs in map paths are simple "<dir>/<pattern-with-*>" — match the last
// segment against the directory listing.
function globMatches(token) {
  const lastSlash = token.lastIndexOf('/');
  const dir = token.slice(0, lastSlash);
  const pat = token.slice(lastSlash + 1);
  if (dir.includes('*') || !existsSync(join(ROOT, dir))) return false;
  const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  try {
    return readdirSync(join(ROOT, dir)).some((f) => re.test(f));
  } catch {
    return false;
  }
}

// Check 4 — content floor per flow (anti-silent-loss, BIN-459). Pushes a
// problem for every flow whose prose has been stripped below the floors above.
export function checkFlowContent(actions, problems) {
  for (const action of actions) {
    const id = action.id || '(unnamed flow)';
    const label = String(action.label ?? '').trim();
    const desc = String(action.description ?? '').trim();
    const steps = Array.isArray(action.steps) ? action.steps : [];

    if (label.length < MIN_FLOW_LABEL) {
      problems.push(`flow '${id}': missing/thin label (< ${MIN_FLOW_LABEL} chars) — prose stripped?`);
    }
    if (desc.length < MIN_FLOW_DESC) {
      problems.push(
        `flow '${id}': description too thin (${desc.length} < ${MIN_FLOW_DESC} chars) — a flow must describe what it does; a revert must not silently gut it`,
      );
    }
    if (steps.length === 0) {
      problems.push(`flow '${id}': has no steps — the flow's transport chain was stripped`);
    }
    steps.forEach((step, i) => {
      if (String(step.payload ?? '').trim().length < MIN_STEP_PAYLOAD) {
        problems.push(`flow '${id}' step ${i + 1}: empty/thin payload (< ${MIN_STEP_PAYLOAD} chars)`);
      }
    });

    const contentLen = flowContentLen(action);
    if (contentLen < MIN_FLOW_CONTENT) {
      problems.push(
        `flow '${id}': total prose too thin (${contentLen} < ${MIN_FLOW_CONTENT} chars across description + step payloads) — restore the lost detail`,
      );
    }
  }
}

// Check 5 — content ratchet (BIN-470). Diffs each flow's live content length
// against the committed per-flow baseline. Unlike the absolute floor (check 4),
// this catches a NET prose loss that still clears the floor — a flow thinned
// from 900 to 200 chars, or a whole baselined flow deleted. New flows (absent
// from the baseline) are only held to the floor until the baseline is next
// regenerated. To intentionally reduce a flow (or drop one), regenerate the
// baseline with --update-baseline and commit it — a conscious, reviewable step.
export function checkContentRatchet(actions, baseline, problems) {
  const flows = baseline?.flows;
  if (!flows || typeof flows !== 'object') return;
  const byId = new Map((actions || []).filter((a) => a && a.id).map((a) => [a.id, a]));
  for (const [id, baseLen] of Object.entries(flows)) {
    if (typeof baseLen !== 'number') continue;
    const action = byId.get(id);
    if (!action) {
      problems.push(
        `flow '${id}': in the content baseline but missing from the map — a whole flow's prose was dropped (net loss). Restore it, or regenerate the baseline if the removal is intentional (node scripts/check-workflow-map.mjs --update-baseline).`,
      );
      continue;
    }
    const curr = flowContentLen(action);
    if (curr < baseLen) {
      problems.push(
        `flow '${id}': prose shrank (${curr} < baseline ${baseLen} chars across description + step payloads) — net loss vs the committed baseline. Re-trace the flow, or regenerate the baseline if the reduction is intentional (node scripts/check-workflow-map.mjs --update-baseline).`,
      );
    }
  }
}

// ── Check 3 — coverage cross-check against the enumerated universe ───────────────────
// docs/workflow-map-universe.json is a plain object of KEY -> string[]. EVERY array-valued
// key is enforced (only "comment" is exempt), so adding or renaming a key — `functions`,
// `routes`, the hand-curated `boundaries` (BIN-760/780) — keeps its entries required
// rather than silently dropping the rule. BIN-789: none of this was tested, and the whole
// `boundaries` guard worked by accident.
const UNIVERSE_COMMENT_KEY = 'comment';

export function universeEntries(universe) {
  return new Set(
    Object.entries(universe || {})
      .filter(([k]) => k !== UNIVERSE_COMMENT_KEY)
      .flatMap(([, v]) => (Array.isArray(v) ? v : []))
      .filter((e) => typeof e === 'string' && e.trim().length > 0),
  );
}

// A covers[] token may name a universe entry exactly, or name a SEGMENT of it — flows say
// `global-error.tsx` where the universe says `src/app/global-error.tsx`, and dynamic-route
// variants extend an entry. Containment must therefore land on '/' boundaries: plain
// substring matching let `/feed` count as covered because some flow claimed `/feedback`,
// i.e. a real hole reading as green (BIN-789). Tokens shorter than MIN_FUZZY_LEN (notably
// the root route '/') only ever match exactly.
const MIN_FUZZY_LEN = 4;

// TAIL only, on a '/' boundary. Matching the needle anywhere inside the haystack would let
// a flow claiming 'src/app' cover every universe entry beneath it — one flow silently
// documenting a whole directory is the same green-on-a-hole failure BIN-789 fixed for
// '/feed' vs '/feedback', just one level up.
function segmentTail(haystack, needle) {
  if (!haystack.endsWith(needle)) return false;
  const before = haystack.length - needle.length;
  return before === 0 || haystack[before - 1] === '/';
}

export function coversEntry(claim, entry) {
  if (typeof claim !== 'string' || typeof entry !== 'string') return false;
  if (claim === entry) return true;
  if (claim.length < MIN_FUZZY_LEN || entry.length < MIN_FUZZY_LEN) return false;
  // ONE direction only: the claim may be a shorter, whole-segment tail of the entry
  // ('global-error.tsx' → 'src/app/global-error.tsx'). The reverse — a deeper path
  // claiming a broader entry — is NOT coverage: a flow that touches one file under
  // 'src/app' has not documented 'src/app'.
  return segmentTail(entry, claim);
}

export function checkCoverage(universe, actions, problems) {
  const entries = universeEntries(universe);
  const claimed = new Set();
  for (const action of actions || []) {
    for (const c of action?.covers || []) claimed.add(c);
  }
  const claimedList = [...claimed];
  let covered = 0;
  for (const entry of [...entries].sort()) {
    if (claimedList.some((c) => coversEntry(c, entry))) covered += 1;
    else problems.push(`universe entry '${entry}' is not covered by any flow (add it to a flow's covers[])`);
  }
  return { covered, universeSize: entries.size };
}

// Build the content-baseline object from the current flows. Deterministic
// (flows keyed by id, no timestamp) so the committed file only churns when the
// prose actually changes.
export function buildBaseline(actions) {
  const flows = {};
  for (const a of actions || []) {
    if (a && a.id) flows[a.id] = flowContentLen(a);
  }
  return {
    comment:
      'Per-flow content baseline (description + step-payload char count) for scripts/check-workflow-map.mjs check 5 (BIN-470). The linter fails if any flow shrinks below its baseline or a baselined flow disappears — catching net prose-loss the absolute floor (check 4) misses. Regenerate + commit when you intentionally shorten or remove a flow: node scripts/check-workflow-map.mjs --update-baseline',
    flows,
  };
}

function writeBaseline() {
  const data = extractDataJson(readFileSync(join(ROOT, MAP_FILE), 'utf8'));
  const baseline = buildBaseline(data.actions || []);
  writeFileSync(join(ROOT, BASELINE_FILE), JSON.stringify(baseline, null, 2) + '\n');
  console.log(
    `workflow-map baseline: wrote ${Object.keys(baseline.flows).length} flow content lengths to ${BASELINE_FILE}`,
  );
}

export function main() {
  const mapPath = join(ROOT, MAP_FILE);
  if (!existsSync(mapPath)) {
    console.log(`workflow-map linter: ${MAP_FILE} missing — skipping`);
    return 0;
  }
  const data = extractDataJson(readFileSync(mapPath, 'utf8'));
  const problems = [];
  const nodeIds = new Set();

  for (const node of data.nodes || []) {
    nodeIds.add(node.id);
    for (const tok of checkableTokens(node.path || '')) {
      if (tok.includes('*')) {
        if (!globMatches(tok)) problems.push(`node '${node.id}': glob matches nothing: ${tok}`);
      } else if (!existsSync(join(ROOT, tok))) {
        problems.push(`node '${node.id}': path missing: ${tok}`);
      }
    }
  }

  for (const action of data.actions || []) {
    (action.steps || []).forEach((step, i) => {
      for (const end of ['from', 'to']) {
        if (!nodeIds.has(step[end])) {
          problems.push(`flow '${action.id}' step ${i + 1}: unknown node id '${step[end]}' in '${end}'`);
        }
      }
    });
  }

  checkFlowContent(data.actions || [], problems);

  // Check 5 — content ratchet against the committed per-flow baseline (BIN-470).
  const baselinePath = join(ROOT, BASELINE_FILE);
  if (existsSync(baselinePath)) {
    let baseline = null;
    try {
      baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    } catch (err) {
      problems.push(`content baseline ${BASELINE_FILE} is not valid JSON: ${err.message}`);
    }
    if (baseline) checkContentRatchet(data.actions || [], baseline, problems);
  }

  // Check 3 — coverage cross-check against the enumerated universe (see checkCoverage).
  let covered = 0, universeSize = 0;
  const universePath = join(ROOT, 'docs/workflow-map-universe.json');
  if (existsSync(universePath)) {
    const universe = JSON.parse(readFileSync(universePath, 'utf8'));
    ({ covered, universeSize } = checkCoverage(universe, data.actions || [], problems));
  }

  if (problems.length) {
    console.error(`workflow-map linter: ${problems.length} problem(s) in ${MAP_FILE}:`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "\nFix: update the nodes[].path entries in the map's JSON data block, or re-trace the affected flow. See CLAUDE.md 'Workflow map freshness'."
    );
    return 1;
  }
  console.log(
    `workflow-map linter: OK — ${nodeIds.size} nodes, ${(data.actions || []).length} flows, all referenced paths exist` +
      (universeSize ? `, coverage ${covered}/${universeSize}` : '')
  );
  return 0;
}

// Only run as a CLI when executed directly (`node scripts/check-workflow-map.mjs`),
// NOT when imported by the test — importing must not call process.exit().
const isDirectRun =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  if (process.argv.includes('--update-baseline')) {
    writeBaseline();
    process.exit(0);
  }
  process.exit(main());
}
