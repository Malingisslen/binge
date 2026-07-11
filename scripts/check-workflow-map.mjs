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
//      routes/endpoints/extension) must be claimed by at least one flow's
//      covers[] — a new function or route without a mapped flow fails CI.
//   4. CONTENT FLOOR: every flow must carry substantive prose — a label, a
//      real description, at least one step, and a non-empty payload on every
//      step. This is the anti-silent-loss guard (BIN-459): coverage (check 3)
//      only asserts a flow EXISTS and still names its covers[], so a
//      feature-revert that keeps the flow shell but strips its description /
//      steps / payloads down to a stub used to pass green. The floors are set
//      below the current data's minimums, so a flow gutted of its prose now
//      trips CI instead of vanishing silently. (Cross-commit partial thinning
//      of an already-substantive description isn't mechanically detectable
//      here — that's what the "keep map edits in their own commit" discipline
//      in .claude/rules/lessons-digest.md defends.)
// Semantic drift (behavior changed inside a still-existing file) is handled by
// .claude/hooks/map-freshness.mjs + .claude/state/workflow-map-stale.json.
//
// Usage: node scripts/check-workflow-map.mjs   (exit 1 with a problem list)

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_FILE = 'docs/workflow-map.html';
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

function extractDataJson(html) {
  const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no <script id="data"> block found');
  return JSON.parse(m[1]);
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
function checkFlowContent(actions, problems) {
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

    const contentLen = desc.length + steps.reduce((n, s) => n + String(s.payload ?? '').trim().length, 0);
    if (contentLen < MIN_FLOW_CONTENT) {
      problems.push(
        `flow '${id}': total prose too thin (${contentLen} < ${MIN_FLOW_CONTENT} chars across description + step payloads) — restore the lost detail`,
      );
    }
  }
}

function main() {
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

  // Coverage cross-check against the enumerated universe.
  let covered = 0, universeSize = 0;
  const universePath = join(ROOT, 'docs/workflow-map-universe.json');
  if (existsSync(universePath)) {
    const universe = JSON.parse(readFileSync(universePath, 'utf8'));
    const universeEntries = new Set(
      Object.entries(universe)
        .filter(([k]) => k !== 'comment')
        .flatMap(([, v]) => (Array.isArray(v) ? v : []))
    );
    universeSize = universeEntries.size;
    const claimed = new Set();
    for (const action of data.actions || []) {
      for (const c of action.covers || []) claimed.add(c);
    }
    for (const entry of [...universeEntries].sort()) {
      // covers[] may name a universe entry directly, or a dynamic-route variant.
      // Fuzzy containment only for entries long enough not to over-match ('/'!).
      const hit =
        claimed.has(entry) ||
        (entry.length > 3 && [...claimed].some((c) => c.length > 3 && (c.includes(entry) || entry.includes(c))));
      if (hit) covered += 1;
      else problems.push(`universe entry '${entry}' is not covered by any flow (add it to a flow's covers[])`);
    }
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

process.exit(main());
