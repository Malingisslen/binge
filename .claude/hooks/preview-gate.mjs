#!/usr/bin/env node
// PreToolUse(Write) — a NEW route screen may not be created until a
// design-directions preview has been shown to Malin for it.
//
// Malin can't read code but reads every visual, and recognising a preference is
// far easier than specifying one. So a new screen starts from "react to these
// variants", not from code she can't see. This hook makes that step physics
// rather than a good intention.
//
// Ported from Butlery's preview-gate.sh (2026-08-08). Node rather than bash+python
// because this repo already runs on Node and the bash version's path handling was
// three nested interpreters deep.
//
// Fires ONLY when: tool is Write, target does not exist yet, and the path is a
// Next.js route screen — src/app/**/{page,layout,template}.tsx. Editing an
// existing screen, adding a component, or any non-route file never trips it.
//
// Satisfy it with a marker:  ~/.claude/state/preview-done-<slug>.marker
// (<slug> = the route path, slashes to dashes: "grupper-ny"). The /preview skill
// in --directions mode stamps this after showing variants and collecting picks.
// Escape hatch for a genuinely non-visual route or a mechanical move:
// SKIP_PREVIEW_GATE=1.
//
// Fails OPEN on any parse error — never brick file creation on a bad payload.
//
// BIN-1036 — the decision is a pure function and the CLI is behind an entry-point
// check, the shape BIN-1009 gave `freshness.mjs` for the same reason: this file used
// to run its whole CLI at import, so importing it from a test read the runner's stdin
// and killed the process at the first `process.exit`. `decide()` takes its world as
// arguments — home directory and an existence probe included — so a test can drive the
// blocking branch without touching the real `~/.claude/state/`, which is a live
// directory the founder's own `/preview` runs write into.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const readStdin = () => {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
};

// C:/x, /c/x and c:\x must compare equal, or a gate that works from one shell
// silently stops firing from another.
export const norm = (p) => {
  let s = String(p || '').replace(/\\/g, '/');
  const m = s.match(/^\/([a-zA-Z])\/(.*)$/);
  if (m) s = `${m[1].toUpperCase()}:/${m[2]}`;
  else if (/^[a-zA-Z]:\//.test(s)) s = s[0].toUpperCase() + s.slice(1);
  return s;
};

/** The route screen a repo-relative path names, or null if it is not one. */
export const routeMatch = (rel) => rel.match(/^src\/app\/(.*)\/(page|layout|template)\.tsx$/);

/**
 * Route groups and dynamic segments are noise in a marker name: (marketing)
 * and [slug] describe routing, not the screen Malin looked at.
 */
export const slugFor = (routePath) =>
  routePath
    .split('/')
    .filter((seg) => !/^\(.*\)$/.test(seg))
    .map((seg) => seg.replace(/^\[+\.{0,3}|\]+$/g, ''))
    .filter(Boolean)
    .join('-') || 'root';

export const markerPath = (slug, home) =>
  path.join(home, '.claude', 'state', `preview-done-${slug}.marker`);

/**
 * The whole decision, as data: a block reason, or null to let the write through.
 *
 * `exists` is injected rather than reaching for `fs` so the two existence questions —
 * does the target file already exist, does the marker exist — can be answered by a test
 * without a file on disk anywhere.
 */
export function decide(payload, { cwd, home, skip, exists }) {
  if (skip) return null;

  const filePath = norm(payload?.tool_input?.file_path);
  if (!filePath) return null;

  const base = norm(cwd || payload?.cwd || '').replace(/\/$/, '');
  const rel = base && filePath.startsWith(`${base}/`) ? filePath.slice(base.length + 1) : filePath;

  const m = routeMatch(rel);
  if (!m) return null;

  // Only a NEW file trips the gate.
  if (exists(filePath)) return null;

  const slug = slugFor(m[1]);
  const marker = markerPath(slug, home);
  if (exists(marker)) return null;

  return `PREVIEW GATE: creating a new screen (${rel}) with no design-directions preview.

Malin reads visuals, not code — a new screen starts from variants she can react to,
not from code she can't see (.claude/rules/html-previews.md).

Do ONE of:
  1. Run /preview --directions for this screen. It builds 3-4 deliberately
     INCOMPATIBLE takes with steal/skip chips from
     docs/design/previews/_binge-template.html, writes them to
     tasks/previews/${slug}-directions.html and opens it for her. Once her picks are
     folded into the design decision, stamp:
         touch "${marker.replace(/\\/g, '/')}"
     then retry this Write.
  2. Genuinely non-visual route (a redirect, an OG-image handler) or a mechanical
     file move → set SKIP_PREVIEW_GATE=1 and say why in the same breath.

Do NOT build the screen first and preview afterwards — the whole point is that she
shapes it before it exists.`;
}

export function main() {
  try {
    const payload = JSON.parse(readStdin() || '{}');
    const reason = decide(payload, {
      cwd: payload?.cwd || process.cwd(),
      home: os.homedir(),
      skip: process.env.SKIP_PREVIEW_GATE === '1',
      exists: (p) => fs.existsSync(p),
    });
    if (reason) process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  } catch {
    // fail open
  }
  process.exit(0);
}

// Same guard as `freshness.mjs`, and correct for the same reason: `process.argv[1]` is
// the script node was told to run, so it equals this file only when this file IS the
// entry point. An import leaves it pointing at the importer — the test runner here.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
