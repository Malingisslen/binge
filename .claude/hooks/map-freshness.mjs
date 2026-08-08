#!/usr/bin/env node
// map-freshness.mjs — PostToolUse(Write|Edit|MultiEdit) hook.
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
