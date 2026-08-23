#!/usr/bin/env node
// map-freshness.mjs — PostToolUse hook.
// When an edited file is referenced by a node in docs/workflow-map.html (the
// data-driven architecture map), the map's flow descriptions may have drifted —
// stamp .claude/state/workflow-map-stale.json with the trigger path.
//
// Refresh procedure (any session that sees the flag): re-trace ONLY the flows
// whose nodes match the trigger paths, update the map's <script id="data">
// JSON, run `node scripts/check-workflow-map.mjs`, delete the flag.
//
// Sibling of dossier-freshness.mjs — same contract: no auditing here, only a
// small JSON flag. Fails OPEN: any error exits 0.
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
// by `git apply` of a held sprint patch. The flag was untouched:
// `.claude/state/workflow-map-stale.json` still reads lastStampedAt
// 2026-08-21T22:15:49.518Z. (Its `triggers` array already named that file from an earlier
// tool-call edit, so nothing was LOST that day — but nothing was recorded either, and the
// two are indistinguishable from the flag.) BIN-968 tracks that same flag surviving
// sprints unread.
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

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const MAP_REL = 'docs/workflow-map.html';
const FLAG_REL = '.claude/state/workflow-map-stale.json';
const REPO_ROOTS = ['src/', 'functions/', 'extension/', 'public/', 'shared/'];
const ROOT_FILES = ['firestore.rules', 'firebase.json'];

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
      if (REPO_ROOTS.some((r) => tok.startsWith(r)) || ROOT_FILES.includes(tok)) tokens.push(tok);
    }
  }
  return tokens;
}

function matches(rel, tok) {
  if (rel === tok) return true;
  if (tok.includes('*')) {
    const re = new RegExp(
      '^' + tok.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$'
    );
    if (re.test(rel)) return true;
  }
  // token names a directory the edited file lives in
  if (!/\.[a-z]+$/i.test(tok) && rel.startsWith(tok.replace(/\/$/, '') + '/')) return true;
  return false;
}

function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch { return; }

  const ti = payload.tool_input || {};
  const filePath = ti.file_path || ti.notebook_path || ti.path;
  if (!filePath) return;

  let repoRoot = process.env.CLAUDE_PROJECT_DIR || '';
  if (!repoRoot) {
    try { repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* */ }
  }
  if (!repoRoot) repoRoot = process.cwd();

  let rel = String(filePath).replace(/\\/g, '/');
  const rootPosix = repoRoot.replace(/\\/g, '/').replace(/\/$/, '');
  if (rel.startsWith(rootPosix + '/')) rel = rel.slice(rootPosix.length + 1);
  rel = rel.replace(/^\.\//, '');

  // anti-loop: the map, the flag, and hook machinery never stamp
  if (!rel || rel === MAP_REL || rel.startsWith('.claude/')) return;

  if (!mapTokens(repoRoot).some((tok) => matches(rel, tok))) return;

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

try { main(); } catch { /* fail open */ }
process.exit(0);
