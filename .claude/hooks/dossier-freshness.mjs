#!/usr/bin/env node
// dossier-freshness.mjs — PostToolUse(Write|Edit|MultiEdit|NotebookEdit) hook.
// When a file is written/edited, match its repo-relative path against the committed
// ownership map (docs/org/ownership-map.json) and drop a staleness marker for every
// role that owns a matching path. The /refresh-dossiers skill later re-audits ONLY
// the flagged roles and clears their markers.
//
// This hook ONLY ever writes documentation-freshness markers under .claude/state/ —
// it never touches app code, never blocks, and produces no tool output.
// Fails OPEN on any error (exit 0). Ships with no markers (all dossiers fresh).
//
// Markers: .claude/state/dossier-stale/<roleNumber>.marker (gitignored), each line
// "<editedPath>\t<utc-timestamp>". Self-edits to the docs that DEFINE the system
// (.claude/, docs/org/, the role doc itself) are skipped so the loop can't self-trigger.
//
// Node port of the former dossier-freshness.ps1 — same contract, but avoids the
// ~1.5s PowerShell cold-start on every edit. Sibling of map-freshness.mjs.

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const MAP_REL = 'docs/org/ownership-map.json';

// Port of Test-PatternMatch: case-insensitive, forward-slash patterns.
function patternMatch(relLower, pattern) {
  const p = String(pattern).replace(/\\/g, '/').toLowerCase();
  if (p.includes('*')) {
    const rx = new RegExp(
      '^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$'
    );
    return rx.test(relLower);
  }
  if (p.endsWith('/')) return relLower.startsWith(p);            // dir prefix
  if (!p.includes('/')) return relLower === p;                    // root file
  return relLower === p || relLower.startsWith(p + '/');
}

function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  if (!raw || !raw.trim()) return;
  let payload = {};
  try { payload = JSON.parse(raw); } catch { return; }

  const tool = String(payload.tool_name || '');
  if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) return;

  const ti = payload.tool_input || {};
  const filePath = ti.file_path || ti.notebook_path || ti.path;
  if (!filePath || !String(filePath).trim()) return;

  let repoRoot = process.env.CLAUDE_PROJECT_DIR || '';
  if (!repoRoot) {
    try {
      repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
    } catch { /* */ }
  }
  if (!repoRoot) repoRoot = process.cwd();

  // Repo-relative, forward-slash.
  let rel = String(filePath).replace(/\\/g, '/');
  const rootPosix = repoRoot.replace(/\\/g, '/').replace(/\/$/, '');
  if (rel.toLowerCase().startsWith(rootPosix.toLowerCase() + '/')) {
    rel = rel.slice(rootPosix.length + 1);
  }
  rel = rel.replace(/^\.\//, '');
  const relLower = rel.toLowerCase();

  // Skip the docs that define the system (no self-trigger) + non-repo paths.
  if (relLower.startsWith('.claude/')) return;
  if (relLower.startsWith('docs/org/')) return;
  if (relLower === 'docs/role-responsibilities.md') return;
  if (rel.startsWith('/') || /^[a-zA-Z]:\//.test(rel)) return;   // outside repo

  const mapPath = join(repoRoot, MAP_REL);
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

try { main(); } catch { /* fail open */ }
process.exit(0);
