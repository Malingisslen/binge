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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const readStdin = () => {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
};

// C:/x, /c/x and c:\x must compare equal, or a gate that works from one shell
// silently stops firing from another.
const norm = (p) => {
  let s = String(p || '').replace(/\\/g, '/');
  const m = s.match(/^\/([a-zA-Z])\/(.*)$/);
  if (m) s = `${m[1].toUpperCase()}:/${m[2]}`;
  else if (/^[a-zA-Z]:\//.test(s)) s = s[0].toUpperCase() + s.slice(1);
  return s;
};

const block = (reason) => {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
};

try {
  if (process.env.SKIP_PREVIEW_GATE === '1') process.exit(0);

  const payload = JSON.parse(readStdin() || '{}');
  const filePath = norm(payload?.tool_input?.file_path);
  if (!filePath) process.exit(0);

  const cwd = norm(payload?.cwd || process.cwd()).replace(/\/$/, '');
  const rel = filePath.startsWith(`${cwd}/`) ? filePath.slice(cwd.length + 1) : filePath;

  const m = rel.match(/^src\/app\/(.*)\/(page|layout|template)\.tsx$/);
  if (!m) process.exit(0);

  // Only a NEW file trips the gate.
  if (fs.existsSync(filePath)) process.exit(0);

  // Route groups and dynamic segments are noise in a marker name: (marketing)
  // and [slug] describe routing, not the screen Malin looked at.
  const slug = m[1]
    .split('/')
    .filter((seg) => !/^\(.*\)$/.test(seg))
    .map((seg) => seg.replace(/^\[+\.{0,3}|\]+$/g, ''))
    .filter(Boolean)
    .join('-') || 'root';

  const marker = path.join(os.homedir(), '.claude', 'state', `preview-done-${slug}.marker`);
  if (fs.existsSync(marker)) process.exit(0);

  block(`PREVIEW GATE: creating a new screen (${rel}) with no design-directions preview.

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
shapes it before it exists.`);
} catch {
  process.exit(0); // fail open
}
