#!/usr/bin/env node
// freshness.mjs — PostToolUse(Write|Edit|MultiEdit|NotebookEdit) hook.
//
// Two independent staleness stampers in ONE process:
//   stampDossier — matches the edited path against the committed ownership map
//     (docs/org/ownership-map.json) and drops a marker for every role that owns a
//     matching path. The /refresh-dossiers skill later re-audits ONLY the flagged
//     roles and clears their markers.
//     Markers: .claude/state/dossier-stale/<roleNumber>.marker (gitignored), each
//     line "<editedPath>\t<utc-timestamp>".
//   stampMap — when the edited file is referenced by a node in docs/workflow-map.html
//     (the data-driven architecture map), the map's flow descriptions may have drifted;
//     stamp .claude/state/workflow-map-stale.json with the trigger path.
//     Refresh procedure (any session that sees the flag): re-trace ONLY the flows whose
//     nodes match the trigger paths, update the map's <script id="data"> JSON, run
//     `node scripts/check-workflow-map.mjs`, delete the flag.
//
// WHY ONE PROCESS. These ran as two separate hook registrations until 2026-08-23, which
// meant two `bash -c` + two `git rev-parse` + two node cold starts on EVERY edit. Process
// startup, not the script bodies, was the cost: the bodies read one JSON file and append a
// line. Merging removes one node cold start and one `bash -c`; with CLAUDE_PROJECT_DIR set
// it removes BOTH `git rev-parse` calls, since the wrapper now prefers the env var the way
// the script already did.
//
// CONTRACT (unchanged from the two files this replaces): this hook ONLY ever writes
// documentation-freshness markers under .claude/state/ — it never touches app code, never
// blocks, and produces no tool output. Fails OPEN on any error (exit 0). Each stamper runs
// in its own try/catch so a throw in one can never stop the other.
//
// Self-edits to the docs that DEFINE the system (.claude/, docs/org/, the role doc, the map
// itself) are skipped so the loop can't self-trigger.

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const OWNERSHIP_REL = 'docs/org/ownership-map.json';
const MAP_REL = 'docs/workflow-map.html';
const FLAG_REL = '.claude/state/workflow-map-stale.json';
const MAP_ROOTS = ['src/', 'functions/', 'extension/', 'public/', 'shared/'];
const MAP_ROOT_FILES = ['firestore.rules', 'firebase.json'];

// ── shared resolution ────────────────────────────────────────────────────────────

function resolveRepoRoot() {
  let repoRoot = process.env.CLAUDE_PROJECT_DIR || '';
  if (!repoRoot) {
    try {
      repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
    } catch { /* */ }
  }
  return repoRoot || process.cwd();
}

// Repo-relative, forward-slash. Case-insensitive prefix strip: on Windows the path Claude
// reports and the one `git rev-parse` returns routinely differ in drive-letter case, and a
// case-sensitive compare leaves an absolute path that matches nothing.
function toRepoRelative(filePath, repoRoot) {
  let rel = String(filePath).replace(/\\/g, '/');
  const rootPosix = repoRoot.replace(/\\/g, '/').replace(/\/$/, '');
  if (rel.toLowerCase().startsWith(rootPosix.toLowerCase() + '/')) {
    rel = rel.slice(rootPosix.length + 1);
  }
  return rel.replace(/^\.\//, '');
}

function globToRegExp(pattern) {
  return new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$'
  );
}

// ── stampDossier ─────────────────────────────────────────────────────────────────

// Port of Test-PatternMatch: case-insensitive, forward-slash patterns.
function patternMatch(relLower, pattern) {
  const p = String(pattern).replace(/\\/g, '/').toLowerCase();
  if (p.includes('*')) return globToRegExp(p).test(relLower);
  if (p.endsWith('/')) return relLower.startsWith(p);            // dir prefix
  if (!p.includes('/')) return relLower === p;                    // root file
  return relLower === p || relLower.startsWith(p + '/');
}

function stampDossier(payload, repoRoot, rel) {
  const tool = String(payload.tool_name || '');
  if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) return;

  const relLower = rel.toLowerCase();

  // Skip the docs that define the system (no self-trigger) + non-repo paths.
  if (relLower.startsWith('.claude/')) return;
  if (relLower.startsWith('docs/org/')) return;
  if (relLower === 'docs/role-responsibilities.md') return;
  if (rel.startsWith('/') || /^[a-zA-Z]:\//.test(rel)) return;   // outside repo

  const mapPath = join(repoRoot, OWNERSHIP_REL);
  if (!existsSync(mapPath)) return;
  let map;
  try { map = JSON.parse(readFileSync(mapPath, 'utf8')); } catch { return; }
  const roles = (map && map.roles) || {};

  const owning = new Set();
  for (const [num, def] of Object.entries(roles)) {
    for (const pat of (def.patterns || [])) {
      if (patternMatch(relLower, pat)) { owning.add(num); break; }
    }
  }
  if (owning.size === 0) return;

  const staleDir = join(repoRoot, '.claude/state/dossier-stale');
  try { if (!existsSync(staleDir)) mkdirSync(staleDir, { recursive: true }); } catch { return; }

  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (const num of owning) {
    try { appendFileSync(join(staleDir, `${num}.marker`), `${rel}\t${stamp}\n`); } catch { /* fail open */ }
  }
}

// ── stampMap ─────────────────────────────────────────────────────────────────────
//
// ── THE GIT-APPLY GAP: ACCEPTED, 2026-08-23, BIN-969 ───────────────────────────────
//
// The decision is written here, at the mechanism, rather than in a doc nothing points at.
//
// THE GAP. This is a PostToolUse hook. `.claude/settings.json` registers it under the
// matcher "Write|Edit|MultiEdit|NotebookEdit", so it fires once per matching TOOL CALL
// and never otherwise. Code that reaches the tree any other way — `git apply`,
// `git stash pop`, `git checkout`, a merge, or a heredoc through Bash — produces no such
// call and stamps nothing. Coverage therefore depends on HOW an edit arrived, not on
// WHAT changed, which is the same shape as the drift BIN-891 is about.
//
// IT IS NOT HYPOTHETICAL. `55fbe7b` rewrote src/contexts/WatchlistContext.tsx
// — node `watchlist-context` in the map, docs/workflow-map.html:189-193 — and it got there
// by `git apply` of a held sprint patch, and stamped nothing. (Its `triggers` array already
// named that file from an earlier tool-call edit, so nothing was LOST that day — but nothing
// was recorded either, and the two are indistinguishable from the flag.) BIN-968 tracks that
// same flag surviving sprints unread.
//   (A clause pinning the flag's lastStampedAt was struck here on 2026-08-23: the flag is a
//   gitignored per-run file that re-stamps on every mapped edit, so no timestamp written into
//   a comment can stay true past the next edit. The historical claim above stands without it.)
//
// DECISION: ACCEPTED, NOT PLUGGED — and bounded on all four axes, because an unbounded
// waiver is the failure BIN-915 recorded.
//
//   MECHANISM — only non-tool writes are uncovered. Every Write/Edit/MultiEdit/
//     NotebookEdit still stamps, unchanged.
//   SEVERITY — what can go unnoticed is PROSE drift on a node the map already lists.
//     Structure is not affected: scripts/check-workflow-map.mjs walks the tree for node
//     paths, flow-step references and all three universe lists (routes, functions, crash
//     boundaries), both directions, and ci.yml + deploy.yml run it. A rename, a deletion,
//     a new route or Cloud Function still fails regardless of how the code arrived.
//   SCOPE — this flag file only. No gate is weakened and no reviewer is skipped.
//   TIME — revisit the first time a git-apply landing actually ships map prose that is
//     wrong. Until then the remedy is procedural and already sits in the recovery path:
//     whoever applies a held batch patch re-reads the flag and the flows it names.
//
// WHY NOT PLUG IT HERE. A PostToolUse hook is handed a tool call; it is never told about
// a git operation, so no edit to THIS file can close it. Closing it means a different
// mechanism — deriving the trigger set from the staged diff in a pre-commit step — which
// is a new blocking obligation on shared commit machinery, outside this file, and against
// Malin's standing narrow-before-broad call. That shape is recorded here as what a future
// ticket would build, deliberately not built now.
//
// HONEST RESIDUE, since an accept that undersells itself is worthless: this flag is also
// the only thing that tells a LATER session to re-trace. Accepting the gap means a
// git-apply landing leaves no such note for anyone, and the map linter cannot supply one
// because it does not read prose.

function mapTokens(repoRoot) {
  const mapPath = join(repoRoot, MAP_REL);
  if (!existsSync(mapPath)) return [];
  const m = readFileSync(mapPath, 'utf8').match(
    /<script id="data" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }
  const tokens = [];
  for (const node of data.nodes || []) {
    for (const raw of String(node.path || '').split(',')) {
      const tok = raw.trim().replace(/:\d+(-\d+)?$/, '');
      if (MAP_ROOTS.some((r) => tok.startsWith(r)) || MAP_ROOT_FILES.includes(tok)) tokens.push(tok);
    }
  }
  return tokens;
}

function matchesToken(rel, tok) {
  if (rel === tok) return true;
  if (tok.includes('*') && globToRegExp(tok).test(rel)) return true;
  // token names a directory the edited file lives in
  if (!/\.[a-z]+$/i.test(tok) && rel.startsWith(tok.replace(/\/$/, '') + '/')) return true;
  return false;
}

function stampMap(payload, repoRoot, rel) {
  // anti-loop: the map, the flag, and hook machinery never stamp
  if (!rel || rel === MAP_REL || rel.startsWith('.claude/')) return;

  if (!mapTokens(repoRoot).some((tok) => matchesToken(rel, tok))) return;

  const flagPath = join(repoRoot, FLAG_REL);
  const stateDir = join(repoRoot, '.claude/state');
  try { if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true }); } catch { return; }

  const now = new Date().toISOString();
  let flag = { map: MAP_REL, triggers: [], firstStampedAt: now, lastStampedAt: now };
  if (existsSync(flagPath)) {
    try { flag = { ...flag, ...JSON.parse(readFileSync(flagPath, 'utf8')) }; } catch { /* keep default */ }
  }
  const set = new Set(flag.triggers || []);
  set.add(rel);
  flag.triggers = [...set].sort();
  flag.lastStampedAt = now;
  if (!flag.firstStampedAt) flag.firstStampedAt = now;
  try { writeFileSync(flagPath, JSON.stringify(flag, null, 2) + '\n'); } catch { /* fail open */ }
}

// ── entry ────────────────────────────────────────────────────────────────────────

function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  if (!raw || !raw.trim()) return;
  let payload = {};
  try { payload = JSON.parse(raw); } catch { return; }

  const ti = payload.tool_input || {};
  const filePath = ti.file_path || ti.notebook_path || ti.path;
  if (!filePath || !String(filePath).trim()) return;

  const repoRoot = resolveRepoRoot();
  const rel = toRepoRelative(filePath, repoRoot);

  // Isolated: a throw in one stamper must never cost the other its run.
  try { stampDossier(payload, repoRoot, rel); } catch { /* fail open */ }
  try { stampMap(payload, repoRoot, rel); } catch { /* fail open */ }
}

try { main(); } catch { /* fail open */ }
process.exit(0);
