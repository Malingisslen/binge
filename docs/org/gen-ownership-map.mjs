// gen-ownership-map.mjs — regenerate docs/org/ownership-map.json from the role doc.
//
// The map is role -> owned file/path patterns, parsed from docs/role-responsibilities.md
// (the single source of truth). It is NOT hand-maintained: run this to keep it honest.
//   node docs/org/gen-ownership-map.mjs              regenerate + check for new gaps
//   node docs/org/gen-ownership-map.mjs --check      grade gaps only, write nothing
//   node docs/org/gen-ownership-map.mjs --update-gaps  regenerate + re-baseline the gaps
//
// --check grades GAPS against the committed map; it deliberately does not report that the
// committed map itself has drifted from the doc. That comparison is a test's job and
// gen-ownership-map.test.mjs makes it ("regenerates the committed ownership-map.json
// identically"), where it runs under `npm test` instead of waiting for someone to
// remember a flag.
//
// Used by the dossier-freshness PostToolUse hook (.claude/hooks/dossier-freshness.mjs):
// when an edited file matches a role's patterns, that role's dossier is flagged stale.
// Also read by docs/org/route.mjs, which decides who reviews a change.
//
// Parsing rules:
//  - Split the doc into role sections by "## N. Title" headings (1..28; non-role
//    headings like "## Index" are ignored because they aren't numbered).
//  - Collect every backtick-quoted token in the section.
//  - Keep only path-like tokens: a safe charset, and either contains "/", or is an
//    allow-listed root file, or ends in a known file extension.
//  - Brace-expand {a,b,c} segments.
//  - Validate against the REPO, not the working directory (see below), dropping tokens
//    whose path doesn't exist. This filters false positives like `Europe/Stockholm`
//    (a "/"-token that's a TZ, not a path) and references to deleted files.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { route } from './route.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const docPath = join(repoRoot, 'docs', 'role-responsibilities.md');
const outPath = join(repoRoot, 'docs', 'org', 'ownership-map.json');
const gapsPath = join(repoRoot, 'docs', 'org', 'ownership-gaps.json');
const GAPS_REL = 'docs/org/ownership-gaps.json';

const ROOT_FILES = new Set([
  'firestore.rules', 'firestore.indexes.json', 'firebase.json',
  'next.config.mjs', 'tailwind.config.ts', 'vitest.config.ts',
  'package.json', 'CLAUDE.md', 'CLAUDE.local.md',
]);
const EXT_RE = /\.(ts|tsx|js|mjs|cjs|json|css|md|rules|txt|yml|yaml|svg|html)$/;
const SAFE_RE = /^[\w./@{}*,\-]+$/; // path-ish only: no spaces, parens, math operators

// Owned paths that git does NOT track — build artifacts a role genuinely owns.
// BIN-803: existence used to be a bare existsSync against the working copy, which made
// the OUTPUT depend on WHERE the generator ran. `.tmdb-cache/` only exists in the main
// checkout after a build and never in a fresh sprint worktree, so regenerating from a
// worktree silently dropped role #3's build-cache pattern — a map that looks edited
// though nobody edited it, and an owner lost for the surface that costs money.
// Existence is now resolved from `git ls-files` (identical in every checkout of the
// same commit); anything legitimately untracked has to be named here, on purpose.
const UNTRACKED_OWNED = new Set(['.tmdb-cache/']);

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

export function trackedPaths() {
  const out = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  const files = new Set();
  const dirs = new Set();
  for (const f of out.split('\0')) {
    if (!f) continue;
    files.add(f);
    let i = f.indexOf('/');
    while (i >= 0) {
      dirs.add(f.slice(0, i));
      i = f.indexOf('/', i + 1);
    }
  }
  return { files, dirs };
}

// keep a pattern if its concrete base (minus trailing slash / glob tail) is in the repo
function existsInRepo(pattern, tracked) {
  if (UNTRACKED_OWNED.has(pattern)) return true;
  let base = pattern.replace(/\/$/, '');
  const star = base.indexOf('*');
  if (star >= 0) base = base.slice(0, star).replace(/\/$/, '');
  if (!base) return false;
  return tracked.files.has(base) || tracked.dirs.has(base);
}

export function buildMap(tracked) {
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
        if (!existsInRepo(ex, tracked)) { dropped.push(ex); continue; }
        if (!roles[cur].patterns.includes(ex)) roles[cur].patterns.push(ex);
      }
    }
  }

  // flag roles that ended up with no concrete owned paths (keep the map lean + matchable)
  for (const k of Object.keys(roles)) {
    if (roles[k].patterns.length === 0) { roles[k].noPaths = true; }
    roles[k].patterns.sort();
  }

  return {
    map: {
      generatedFrom: 'docs/role-responsibilities.md',
      generatedBy: 'docs/org/gen-ownership-map.mjs',
      note: 'Auto-generated — do not hand-edit. Regenerate: node docs/org/gen-ownership-map.mjs',
      roleCount: Object.keys(roles).length,
      patternCount: Object.values(roles).reduce((n, r) => n + r.patterns.length, 0),
      roles,
    },
    dropped,
  };
}

// ── Ownership gaps (BIN-788 point 2, built in BIN-803) ───────────────────────────────
//
// A gap is a tracked CODE file that lives in a directory the map already enumerates
// file-by-file, but that no pattern names. The router covers those by DIRECTORY
// inheritance, so nothing is unreviewed — but the reviewer it seats is "whoever owns a
// sibling", not a role that ever agreed to own this file, and the map quietly rots as
// the tree grows.
//
// Scope, stated honestly: this catches an owned DIRECTORY gaining an unowned sibling.
// Of BIN-823's two ownerless SEO files it would have caught `selectionManifest.ts`
// (its directory had named siblings) but NOT `selectionSeed.ts` — no role named
// anything in `src/lib/seo/` at the time, so the router called it `unmapped-code`,
// never `inherited`, and it never enters this computation. A brand-new UNOWNED
// DIRECTORY is the bigger hole and is still uncovered; route()'s `unmappedCode` would
// be the second set to baseline if that is ever worth closing.
//
// The verdict comes from route.mjs itself rather than a second copy of the matching
// rules: a file that appears ONLY in some role's `inherited` list is, by the router's own
// definition, an owned folder's unowned sibling. One list, not two (the BIN-830 lesson).
// It leans on one invariant route.mjs does not spell out — that a role's `matched` is a
// superset of its `inherited`. gen-ownership-map.test.mjs pins that, so a refactor which
// made `matched` pattern-only goes red instead of silently reporting no gaps.
//
// The check is a SET ratchet against a committed baseline, never a count — a count-based
// floor stays green while one path leaves and another arrives (BIN-823). 299 such files
// exist today, so failing on all of them would just make the generator unrunnable; it
// fails on files that are NEW since the baseline, which is what "an owned folder GETS an
// unowned sibling" means. Re-baseline deliberately with --update-gaps.
//
// WHERE this actually blocks (BIN-830: check where a rule RUNS, not where it is written).
// Nothing calls this script automatically — not package.json, not any workflow or hook;
// only the interactive /refresh-dossiers skill runs it. The enforcement is
// gen-ownership-map.test.mjs, which `vitest.config.ts` includes and `npm test` runs, and
// `npm test` gates ci.yml AND deploy.yml — the only production path. So a new gap fails
// the DEPLOY. For that reason the test asserts the ratchet's DIRECTION, never equality
// with the baseline: shrinking the gap list is the desired outcome and must never break
// a deploy, even though `main()` below only logs it and returns 0.
export function findGaps(tracked) {
  const codeFiles = [...tracked.files].filter((f) => f.includes('/'));
  const r = route(codeFiles);
  const ownedByPattern = new Set();
  const inheritedOnly = new Set();
  for (const role of r.roles) {
    const inherited = new Set(role.inherited);
    for (const f of role.matched) {
      if (inherited.has(f)) inheritedOnly.add(f);
      else ownedByPattern.add(f);
    }
  }
  return [...inheritedOnly].filter((f) => !ownedByPattern.has(f)).sort();
}

function readAcceptedGaps() {
  if (!existsSync(gapsPath)) return null;
  return new Set(JSON.parse(readFileSync(gapsPath, 'utf8')).accepted || []);
}

function writeAcceptedGaps(gaps) {
  writeFileSync(
    gapsPath,
    JSON.stringify(
      {
        // Keep this text in sync with the committed file's `note` — it is REWRITTEN on every
        // --update-gaps, so a correction made only in the JSON silently reverts (the very
        // self-drift class BIN-803 is about).
        note:
          'Accepted ownership gaps: tracked code files sitting in a directory the ownership map ' +
          'enumerates file-by-file, without a pattern of their own. The router still reviews them by ' +
          'directory inheritance, but no role has named them. This is the BASELINE the generator ' +
          'ratchets against — a NEW gap fails `npm test` (docs/org/gen-ownership-map.test.mjs), ' +
          'which gates ci.yml AND deploy.yml — so a new gap fails the DEPLOY, not just this script. ' +
          'Shrink it by naming files in docs/role-responsibilities.md; re-baseline only on purpose.',
        generatedBy: 'docs/org/gen-ownership-map.mjs --update-gaps',
        count: gaps.length,
        accepted: gaps,
      },
      null,
      2,
    ) + '\n',
  );
}

export function main(argv) {
  const checkOnly = argv.includes('--check');
  const updateGaps = argv.includes('--update-gaps');
  const tracked = trackedPaths();
  const { map, dropped } = buildMap(tracked);

  if (!checkOnly) {
    writeFileSync(outPath, JSON.stringify(map, null, 2) + '\n');
    const withPaths = Object.values(map.roles).filter((r) => r.patterns.length).length;
    console.log(`ownership-map.json: ${map.roleCount} roles (${withPaths} with paths), ${map.patternCount} patterns`);
    console.log(`dropped ${dropped.length} non-existent/non-path tokens (e.g. ${[...new Set(dropped)].slice(0, 6).join(', ')})`);
  }

  // route() reads the map from disk, so --check grades the COMMITTED map and a normal
  // run grades the one just written. Both are the honest question for their mode.
  const gaps = findGaps(tracked);

  if (updateGaps) {
    const before = readAcceptedGaps();
    writeAcceptedGaps(gaps);
    const added = before ? gaps.filter((g) => !before.has(g)) : gaps;
    const removed = before ? [...before].filter((g) => !gaps.includes(g)) : [];
    console.log(`${GAPS_REL}: ${gaps.length} accepted gaps (+${added.length} / -${removed.length})`);
    return 0;
  }

  const accepted = readAcceptedGaps();
  if (accepted === null) {
    console.error(`\nMISSING ${GAPS_REL} — the ownership-gap baseline. Without it a new unowned file cannot be told from an old one.`);
    console.error('Create it deliberately: node docs/org/gen-ownership-map.mjs --update-gaps');
    return 1;
  }

  const newGaps = gaps.filter((g) => !accepted.has(g));
  const stale = [...accepted].filter((g) => !gaps.includes(g));
  if (stale.length) {
    console.log(`${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} no longer a gap (owned or deleted) — clear with --update-gaps.`);
  }
  if (newGaps.length === 0) {
    console.log(`ownership gaps: ${gaps.length}, all baselined in ${GAPS_REL}.`);
    return 0;
  }

  console.error(`\n${newGaps.length} NEW unowned sibling(s) — each sits in a directory the ownership map lists file-by-file, but no role names it:`);
  for (const g of newGaps) console.error(`  ${g}`);
  console.error('\nThe router will seat whoever owns a sibling file, which is a guess, not an owner.');
  console.error('Fix: name the file under the owning role in docs/role-responsibilities.md and re-run.');
  console.error(`Accept it instead (only if no role should own it): node docs/org/gen-ownership-map.mjs --update-gaps`);
  return 1;
}

// Run the CLI only when this file IS the entry point — without the guard, importing
// buildMap/findGaps from a test would run the whole generator and overwrite the map
// (the BIN-802 lesson, applied to the generator as well as the router).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
