// check-workflow-map.mjs — workflow-map freshness linter (CI + local).
//
// NO SHEBANG, deliberately (BIN-891). This module is imported by
// scripts/check-workflow-map.test.mjs, and vitest's transform hoists the
// node-builtin import shims to the top of the file. A `#!` line then ends up
// mid-line and the file fails to PARSE — but only on a checkout where it has
// CRLF endings, i.e. only on Windows (core.autocrlf=true), never in CI. That
// makes it a failure no remote gate can see. Nothing runs this file as a bare
// executable: ci.yml, deploy.yml and the commit gate all invoke it as
// `node scripts/check-workflow-map.mjs`, so the shebang bought nothing.
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
//   6/7. UNIVERSE ENUMERATION: none of the universe's three lists runs on honour any
//      more. Each is walked from the tree and cross-checked BOTH ways — an entry the
//      tree has and the universe lacks fails, and an entry the universe lists that the
//      tree no longer has fails too:
//        - `boundaries` (check 6, BIN-808): every src/app/**/{error,global-error}.tsx;
//        - `functions`  (check 7, BIN-891): every export of functions/src/index.ts;
//        - `routes`     (check 7, BIN-891): every src/app/**/page.tsx, as its URL path.
//      A new crash boundary, Cloud Function or route fails CI until it is in the
//      universe AND claimed by a flow. Exemptions are a path->reason MAP per list, the
//      reason is enforced by this linter (not only by the test file), and an exemption
//      that stops matching something the walk finds fails too — so no list can rot into
//      permission nobody remembers granting. Each walk carries a floor, so a walk broken
//      by a moved directory fails loudly instead of passing vacuously on an empty list.
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
// key is enforced (only "comment" is exempt), so adding or renaming a key — `functions`
// and `routes` (enumerated by check 7), the partly-enumerated `boundaries` (BIN-760/780;
// check 6 walks every entry except the hand-curated ones its predicate excludes) — keeps
// its entries required rather than silently dropping the rule. BIN-789: none of this was
// tested, and the whole `boundaries` guard worked by accident.
//
// Counts are deliberately NOT written into this prose. A comment saying "11 of 12" is
// wrong the moment a twelfth boundary lands, and nothing turns red when it does (BIN-891);
// describe what the walk finds, and let the exported floors carry the only numbers.
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

// ── Checks 6 & 7 — the universe is ENUMERABLE, list by list (BIN-808, BIN-891) ───────
// `boundaries` used to be documented as wholly hand-curated. It is not: an app-router
// crash boundary is any src/app/**/{error,global-error}.tsx, and that set can be walked.
// The ticket originally asked for a heuristic — "imports captureError, is not a route or
// a function export" — which was measured and REJECTED: every segment boundary imports
// the shared SegmentError component (which is what actually calls captureError), so the
// heuristic finds NONE of them, while flagging src/lib/queryClient.ts, which is not a
// boundary at all. Enumerating the filenames is both cheaper and correct.
//
// BIN-891: `functions` and `routes` were left on honour when check 6 shipped, and had
// ALREADY drifted — logRecapMiss, /guider and /calendar/premiarer existed in the tree,
// were absent from the universe, and therefore required no flow at all, quietly falsifying
// CLAUDE.md's "a new function or route requires a map flow". The universe's own comment
// had said all along how to regenerate them (exports of functions/src/index.ts; page.tsx
// directories under src/app), i.e. both were enumerations written as instructions to a
// human. They are walks now, on the same shape as check 6 — which is why the mechanics
// below are ONE parameterized routine and three specs, not three copies that drift.
//
// What stays hand-curated: an off-device-transmitting client file that belongs to no
// route, no function AND no boundary filename — src/components/layout/SegmentError.tsx is
// today's only one. Nothing enumerates those, which is why the universe comment names two
// halves for `boundaries` and none for the other two lists.
const APP_DIR = 'src/app';
const BOUNDARY_FILENAME = /^(error|global-error)\.tsx$/;
const FUNCTIONS_ENTRY = 'functions/src/index.ts';
const ROUTE_FILENAME = 'page.tsx';

// Floors, not counts, and each compares against its own WALK (never against the universe,
// whose hand-curated entries are not walked). A walk that returns nothing — src/app or
// functions/src/index.ts renamed, a permissions error swallowed by a catch below — would
// make every assertion in its check vacuously true, which is the exact silent-pass these
// checks exist to remove. Each is set below today's real number so an ordinary deletion
// does not trip it, and far above zero so a broken walk does. They are exported because a
// literal repeated in the test file is a second answer to one question, and the two drift.
export const MIN_CRASH_BOUNDARIES = 8;
export const MIN_FUNCTION_EXPORTS = 15;
export const MIN_ROUTES = 30;

export function enumerateCrashBoundaries(root = ROOT, dir = APP_DIR) {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...enumerateCrashBoundaries(root, rel));
    else if (BOUNDARY_FILENAME.test(entry.name)) found.push(rel);
  }
  return found.sort();
}

// The functions half of the walk (BIN-891): what functions/src/index.ts actually exports,
// which is exactly what Firebase deploys. Both export shapes in that file count — the two
// inline `export const x = onDocumentCreated(…)` triggers and the twenty-odd
// `export { x } from './x'` re-exports — while `export type` and `export default` are not
// deployable functions and are skipped. Parsing beats a manifest here: the file IS the
// manifest, and any second list of function names would be the drift this check removes.
const EXPORT_DECLARATION = /^[ \t]*export\s+(?!type\b|default\b)(?:async\s+)?(?:const|let|var|function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_NAMED_BLOCK = /^[ \t]*export\s+(?!type\b)\{([^}]*)\}/gm;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

// Split from the file read (the repo's test-extraction convention) so the parse can be
// driven by literal source text in the test file — the walk's fixture problem otherwise
// forces writing temp files, and a parser tested only against the one real file passes
// whenever it happens to agree with today's tree.
export function parseFunctionExports(src) {
  const names = new Set();
  for (const [, name] of src.matchAll(EXPORT_DECLARATION)) names.add(name);
  for (const [, block] of src.matchAll(EXPORT_NAMED_BLOCK)) {
    for (const specifier of block.split(',')) {
      const spec = specifier.trim();
      if (!spec || /^type\s/.test(spec)) continue;
      // `x as y` exports the name y — the local name is invisible to callers and to Firebase.
      const exported = spec.split(/\s+as\s+/).pop().trim();
      if (IDENTIFIER.test(exported) && exported !== 'default') names.add(exported);
    }
  }
  return [...names].sort();
}

export function enumerateFunctionExports(root = ROOT, entry = FUNCTIONS_ENTRY) {
  try {
    return parseFunctionExports(readFileSync(join(root, entry), 'utf8'));
  } catch {
    // An unreadable/moved entry point returns nothing, which the floor then reports as the
    // broken walk it is — never as "this repo deploys no functions".
    return [];
  }
}

// The routes half (BIN-891): every src/app/**/page.tsx, as the URL path a user reaches.
// `src/app/my/films/page.tsx` -> `/my/films`, `src/app/page.tsx` -> `/`. Dynamic segments
// keep their brackets, which is exactly how the universe already writes them
// ('/movie/[id]'). This app has no route groups '(x)' and no parallel routes '@x' — if one
// ever lands, its directory name would wrongly appear in the URL here, and the resulting
// mismatch fails LOUDLY (a route the universe cannot contain) rather than going quiet.
export function enumerateRoutes(root = ROOT, dir = APP_DIR, appDir = dir) {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...enumerateRoutes(root, rel, appDir));
    else if (entry.name === ROUTE_FILENAME) found.push(dir.slice(appDir.length) || '/');
  }
  return [...new Set(found)].sort();
}

// Deliberate exclusions per list, entry -> one line of reason. ALL THREE EMPTY today, and
// that is the honest state: every crash boundary, Cloud Function and route in the tree
// belongs in the universe, and BIN-891's three drifted entries were added to it rather
// than exempted from it. A map rather than an array so an exclusion must carry an argument
// — and the argument is enforced HERE, by the check, not only by the test file
// (integration review, 2026-08-14: `hasOwnProperty` alone silences a path whose value is
// '' or null, so the map shape by itself proves nothing). An entry that stops matching
// something the walk finds is reported too, so no list can rot into permission nobody
// remembers granting.
export const BOUNDARY_EXEMPTIONS = {};
export const FUNCTION_EXEMPTIONS = {};
export const ROUTE_EXEMPTIONS = {};
// Exported for the same reason the floors are: a literal repeated in the test file is a
// second answer to one question, and the two drift (integration review, 2026-08-14 — this
// batch had just removed exactly that divergence for the other floor).
export const MIN_EXEMPTION_REASON = 10;

// The shared mechanics of checks 6 and 7. ONE routine, three specs: the three lists differ
// only in what they walk, what they are called, and which universe entries the walk's own
// predicate could have produced (`inDomain` — see the reverse-direction note below). Three
// hand-copied checks would be three things to keep in step, which is the failure mode this
// whole file exists to prevent.
function checkEnumeratedList(spec, universe, problems, opts = {}) {
  const found = opts.found ?? spec.enumerate();
  const exemptions = opts.exemptions ?? spec.exemptions;
  // `floor` is injectable ONLY so the unit tests can drive the other branches with a
  // tiny fixture without the floor firing alongside them. Production always takes the
  // default; a caller that passes 0 is asking for the vacuous pass this guard removes,
  // which is why the real-data tests call each check with no opts at all.
  const floor = opts.floor ?? spec.floor;
  const listed = new Set(Array.isArray(universe?.[spec.key]) ? universe[spec.key] : []);

  if (found.length < floor) problems.push(spec.floorProblem(found.length, floor));

  for (const item of found) {
    if (listed.has(item) || Object.prototype.hasOwnProperty.call(exemptions, item)) continue;
    problems.push(spec.missingProblem(item));
  }

  const foundSet = new Set(found);
  for (const [item, reason] of Object.entries(exemptions)) {
    if (!foundSet.has(item)) problems.push(spec.staleExemptionProblem(item));
    if (typeof reason !== 'string' || reason.trim().length < MIN_EXEMPTION_REASON) {
      problems.push(spec.unreasonedExemptionProblem(item));
    }
  }

  // The REVERSE direction: an entry the universe still lists but the tree no longer has.
  // Nothing else catches it — check 3 stays green because a flow still claims it, and
  // check 1 only sees the handful of paths that are also nodes[] entries — so the universe
  // and the map would keep documenting a deleted file, function or page forever.
  //
  // `inDomain` is DELIBERATELY the walk's own predicate, so "listed but not found" can only
  // mean deleted. Keying on something looser was probed and rejected (integration review,
  // 2026-08-14): a hand-curated entry named error.tsx outside src/app would be demanded for
  // deletion with a message that is false, because the walk never looked there. The
  // hand-curated half of a list is whatever its predicate excludes; nothing enumerates it.
  for (const item of listed) {
    if (!spec.inDomain(item)) continue;
    if (!foundSet.has(item)) problems.push(spec.deletedProblem(item));
  }
  return found.length;
}

// NOTE: each spec hard-keys its universe key, where check 3 is deliberately key-agnostic.
// Renaming a key leaves check 3 green and makes the matching check here emit one spurious
// "missing" per walked entry — loud and immediately diagnosable, which is the point: an
// enumeration is about one specific list, and guessing which key means "routes" by shape
// would make a rename silently re-target the walk.
const BOUNDARY_LIST = {
  key: 'boundaries',
  enumerate: () => enumerateCrashBoundaries(),
  exemptions: BOUNDARY_EXEMPTIONS,
  floor: MIN_CRASH_BOUNDARIES,
  inDomain: (entry) =>
    entry.startsWith(`${APP_DIR}/`) && BOUNDARY_FILENAME.test(entry.slice(entry.lastIndexOf('/') + 1)),
  floorProblem: (n, floor) =>
    `crash-boundary walk found only ${n} file(s) under ${APP_DIR} (floor ${floor}) — the walk is broken or the app tree moved; this check cannot pass on an empty list.`,
  missingProblem: (file) =>
    `crash boundary '${file}' is missing from docs/workflow-map-universe.json boundaries[] — add it (and claim it in a flow's covers[]), or add it to BOUNDARY_EXEMPTIONS with a reason.`,
  staleExemptionProblem: (file) =>
    `BOUNDARY_EXEMPTIONS names '${file}', which is not a crash boundary in the tree any more — delete the exemption.`,
  unreasonedExemptionProblem: (file) =>
    `BOUNDARY_EXEMPTIONS['${file}'] has no usable reason — an exclusion without an argument is a silence, which is what this check exists to remove.`,
  deletedProblem: (file) =>
    `docs/workflow-map-universe.json lists crash boundary '${file}', which no longer exists in the tree — remove it from boundaries[] and from every flow's covers[].`,
};

const FUNCTION_LIST = {
  key: 'functions',
  enumerate: () => enumerateFunctionExports(),
  exemptions: FUNCTION_EXEMPTIONS,
  floor: MIN_FUNCTION_EXPORTS,
  // A deployed function is a bare identifier. Anything else the list ever grows (a path, a
  // URL) is by definition not something this walk could have produced, so it stays check 3's.
  inDomain: (entry) => IDENTIFIER.test(entry),
  floorProblem: (n, floor) =>
    `Cloud Function walk found only ${n} export(s) in ${FUNCTIONS_ENTRY} (floor ${floor}) — the parse is broken or the entry point moved; this check cannot pass on an empty list.`,
  missingProblem: (name) =>
    `Cloud Function export '${name}' is missing from docs/workflow-map-universe.json functions[] — add it (and claim it in a flow's covers[]), or add it to FUNCTION_EXEMPTIONS with a reason.`,
  staleExemptionProblem: (name) =>
    `FUNCTION_EXEMPTIONS names '${name}', which ${FUNCTIONS_ENTRY} does not export any more — delete the exemption.`,
  unreasonedExemptionProblem: (name) =>
    `FUNCTION_EXEMPTIONS['${name}'] has no usable reason — an exclusion without an argument is a silence, which is what this check exists to remove.`,
  deletedProblem: (name) =>
    `docs/workflow-map-universe.json lists Cloud Function '${name}', which ${FUNCTIONS_ENTRY} no longer exports — remove it from functions[] and from every flow's covers[].`,
};

const ROUTE_LIST = {
  key: 'routes',
  enumerate: () => enumerateRoutes(),
  exemptions: ROUTE_EXEMPTIONS,
  floor: MIN_ROUTES,
  // Every entry the route walk can produce starts with '/'; nothing else in routes[] could
  // have come from a page.tsx, so nothing else is claimed as deleted.
  inDomain: (entry) => entry.startsWith('/'),
  floorProblem: (n, floor) =>
    `route walk found only ${n} ${ROUTE_FILENAME} file(s) under ${APP_DIR} (floor ${floor}) — the walk is broken or the app tree moved; this check cannot pass on an empty list.`,
  missingProblem: (route) =>
    `route '${route}' has a ${ROUTE_FILENAME} under ${APP_DIR} but is missing from docs/workflow-map-universe.json routes[] — add it (and claim it in a flow's covers[]), or add it to ROUTE_EXEMPTIONS with a reason.`,
  staleExemptionProblem: (route) =>
    `ROUTE_EXEMPTIONS names '${route}', which has no ${ROUTE_FILENAME} under ${APP_DIR} any more — delete the exemption.`,
  unreasonedExemptionProblem: (route) =>
    `ROUTE_EXEMPTIONS['${route}'] has no usable reason — an exclusion without an argument is a silence, which is what this check exists to remove.`,
  deletedProblem: (route) =>
    `docs/workflow-map-universe.json lists route '${route}', which no longer has a ${ROUTE_FILENAME} under ${APP_DIR} — remove it from routes[] and from every flow's covers[].`,
};

// The three public entry points. Each keeps its own `opts` alias for the walk result
// (`boundaries` / `functions` / `routes`) so a test reads as what it is driving.
export function checkBoundaryEnumeration(universe, problems, opts = {}) {
  return checkEnumeratedList(BOUNDARY_LIST, universe, problems, { ...opts, found: opts.boundaries });
}

export function checkFunctionEnumeration(universe, problems, opts = {}) {
  return checkEnumeratedList(FUNCTION_LIST, universe, problems, { ...opts, found: opts.functions });
}

export function checkRouteEnumeration(universe, problems, opts = {}) {
  return checkEnumeratedList(ROUTE_LIST, universe, problems, { ...opts, found: opts.routes });
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
    // A newly added boundary fails check 6 FIRST — check 3 iterates universe entries, so
    // while the file is missing from the universe check 3 is structurally silent about it.
    // Check 6's message names both halves of the fix; check 3 only speaks up if the reader
    // did the first half and stopped. One problem, in sequence, never twice at once.
    checkBoundaryEnumeration(universe, problems);
    // Same sequencing for check 7: a brand-new function or route is missing from the
    // universe first, so check 3 has nothing to iterate and stays silent until it is added.
    checkFunctionEnumeration(universe, problems);
    checkRouteEnumeration(universe, problems);
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
