// gen-ownership-map.mjs — regenerate docs/org/ownership-map.json from the role doc.
//
// The map is role -> owned file/path patterns, parsed from docs/role-responsibilities.md
// (the single source of truth). It is NOT hand-maintained: run this to keep it honest.
//   node docs/org/gen-ownership-map.mjs
//
// Used by the dossier-freshness PostToolUse hook (.claude/hooks/dossier-freshness.ps1):
// when an edited file matches a role's patterns, that role's dossier is flagged stale.
//
// Parsing rules:
//  - Split the doc into role sections by "## N. Title" headings (1..28; non-role
//    headings like "## Index" are ignored because they aren't numbered).
//  - Collect every backtick-quoted token in the section.
//  - Keep only path-like tokens: a safe charset, and either contains "/", or is an
//    allow-listed root file, or ends in a known file extension.
//  - Brace-expand {a,b,c} segments.
//  - FS-validate: drop tokens whose path (or parent dir) doesn't exist in the repo.
//    This filters false positives like `Europe/Stockholm` (a "/"-token that's a TZ,
//    not a path) and stale references to deleted files (which couldn't match anyway).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const docPath = join(repoRoot, 'docs', 'role-responsibilities.md');
const outPath = join(repoRoot, 'docs', 'org', 'ownership-map.json');

const ROOT_FILES = new Set([
  'firestore.rules', 'firestore.indexes.json', 'firebase.json',
  'next.config.mjs', 'tailwind.config.ts', 'vitest.config.ts',
  'package.json', 'CLAUDE.md', 'CLAUDE.local.md',
]);
const EXT_RE = /\.(ts|tsx|js|mjs|cjs|json|css|md|rules|txt|yml|yaml|svg|html)$/;
const SAFE_RE = /^[\w./@{}*,\-]+$/; // path-ish only: no spaces, parens, math operators

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// {a,b,c} -> [a, b, c] expansion (single-level, sufficient for the doc's paths)
function expandBraces(tok) {
  const m = tok.match(/^(.*)\{([^}]+)\}(.*)$/);
  if (!m) return [tok];
  const [, pre, body, post] = m;
  return body.split(',').flatMap((part) => expandBraces(pre + part + post));
}

function looksLikePath(tok) {
  if (!SAFE_RE.test(tok)) return false;
  if (tok.includes('/')) return true;
  if (ROOT_FILES.has(tok)) return true;
  if (EXT_RE.test(tok)) return true;
  return false;
}

// keep a pattern if its concrete base (minus trailing slash / glob tail) exists
function existsInRepo(pattern) {
  let base = pattern.replace(/\/$/, '');
  const star = base.indexOf('*');
  if (star >= 0) base = base.slice(0, star).replace(/\/$/, '');
  if (!base) return false;
  const abs = join(repoRoot, base);
  if (existsSync(abs)) return true;
  // dir-pattern whose own dir doesn't exist but parent does (rare) — be strict: require base
  return false;
}

const doc = readFileSync(docPath, 'utf8');
const lines = doc.split(/\r?\n/);

const roles = {};
let cur = null;
const dropped = [];

for (const line of lines) {
  const h = line.match(/^##\s+(\d+)\.\s+(.+?)\s*$/);
  if (h) {
    const [, num, title] = h;
    cur = num;
    roles[num] = { title, slug: slugify(title), patterns: [] };
    continue;
  }
  if (line.startsWith('## ')) { cur = null; continue; } // non-numbered section
  if (!cur) continue;
  const toks = line.match(/`([^`]+)`/g) || [];
  for (const raw of toks) {
    const tok = raw.slice(1, -1).trim();
    if (!looksLikePath(tok)) continue;
    for (const ex of expandBraces(tok)) {
      if (!looksLikePath(ex)) continue;
      if (!existsInRepo(ex)) { dropped.push(ex); continue; }
      if (!roles[cur].patterns.includes(ex)) roles[cur].patterns.push(ex);
    }
  }
}

// drop roles that ended up with no concrete owned paths (keep the map lean + matchable)
for (const k of Object.keys(roles)) {
  if (roles[k].patterns.length === 0) { roles[k].noPaths = true; }
  roles[k].patterns.sort();
}

const out = {
  generatedFrom: 'docs/role-responsibilities.md',
  generatedBy: 'docs/org/gen-ownership-map.mjs',
  note: 'Auto-generated — do not hand-edit. Regenerate: node docs/org/gen-ownership-map.mjs',
  roleCount: Object.keys(roles).length,
  patternCount: Object.values(roles).reduce((n, r) => n + r.patterns.length, 0),
  roles,
};

writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

const withPaths = Object.values(roles).filter((r) => r.patterns.length).length;
console.log(`ownership-map.json: ${out.roleCount} roles (${withPaths} with paths), ${out.patternCount} patterns`);
console.log(`dropped ${dropped.length} non-existent/non-path tokens (e.g. ${[...new Set(dropped)].slice(0, 6).join(', ')})`);
