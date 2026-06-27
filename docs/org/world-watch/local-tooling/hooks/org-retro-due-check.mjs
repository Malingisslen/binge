#!/usr/bin/env node
// org-retro-due-check.mjs — SessionStart hook (Node, cross-platform).
//
// Deterministic, does NO analysis: it only reads docs/org/metrics/retro-schedule.json,
// checks whether each scheduled retro's window has passed AND whether it's already been
// run (a {"type":"retro","mode":"<mode>"} line in events.jsonl), and if any are due it
// injects a SessionStart reminder to run /org-retro <mode>.
//
// Self-clearing: the /org-retro skill logs a retro event on each run → this hook reads
// that as "done" → the nudge stops until the next window. No separate done-state.
//
// Once-per-day lock (.claude/state/org-retro-lastcheck) → nudges at most once per day.
// FAILS OPEN: any error exits 0 with no output, never blocking a session.
//
// Written in Node (not PowerShell) so it runs identically in CI/other shells and on a
// fresh checkout, avoiding the .ps1 "silently no-ops if powershell is unavailable" trap.
//
// Test seams (env overrides; production uses the defaults): ORG_RETRO_SCHEDULE,
// ORG_RETRO_EVENTS, ORG_RETRO_LOCK.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const here = dirname(fileURLToPath(import.meta.url)); // <repo>/.claude/hooks
  const repoRoot = process.env.CLAUDE_PROJECT_DIR && existsSync(join(process.env.CLAUDE_PROJECT_DIR, 'docs'))
    ? process.env.CLAUDE_PROJECT_DIR
    : join(here, '..', '..');

  const schedulePath = process.env.ORG_RETRO_SCHEDULE || join(repoRoot, 'docs/org/metrics/retro-schedule.json');
  const eventsPath   = process.env.ORG_RETRO_EVENTS   || join(repoRoot, 'docs/org/metrics/events.jsonl');
  const lockPath     = process.env.ORG_RETRO_LOCK     || join(repoRoot, '.claude/state/org-retro-lastcheck');

  if (!existsSync(schedulePath)) process.exit(0); // nothing scheduled → silent

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  // Once-per-day lock: if we already checked today, stay silent.
  try {
    if (existsSync(lockPath) && readFileSync(lockPath, 'utf8').trim() === today) process.exit(0);
  } catch { /* ignore lock read errors */ }

  const sched = JSON.parse(readFileSync(schedulePath, 'utf8'));
  const goLive = String(sched.goLive || '').slice(0, 10);
  const retros = Array.isArray(sched.retros) ? sched.retros : [];
  if (!goLive) process.exit(0);

  // Done modes = any retro event already logged (the skill writes these; reuse as done-state).
  const done = new Set();
  try {
    if (existsSync(eventsPath)) {
      for (const line of readFileSync(eventsPath, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev && ev.type === 'retro' && ev.mode) done.add(ev.mode);
      }
    }
  } catch { /* ignore events read errors */ }

  const daysSince = Math.floor(
    (Date.parse(today + 'T00:00:00Z') - Date.parse(goLive + 'T00:00:00Z')) / 86400000
  );

  const due = retros.filter(
    (r) => r && r.mode && !done.has(r.mode) && Number.isFinite(Number(r.afterDays)) && daysSince >= Number(r.afterDays)
  );

  // Record that we checked today (once-per-day contract), regardless of outcome.
  try { mkdirSync(dirname(lockPath), { recursive: true }); writeFileSync(lockPath, today); } catch { /* ignore */ }

  if (due.length === 0) process.exit(0); // nothing due → silent

  const lines = [
    'ORG-RETRO: a scheduled role-org retrospective is due:',
    ...due.map((r) => `  - run /org-retro ${r.mode}   (window ${r.afterDays}d since go-live ${goLive}; today is ${daysSince}d in)`),
    '',
    'Run it interactively to score the role-org — rubber-stamp rate, trigger calibration,',
    'world-watch signal/noise + source health, freshness accuracy, cost/review — plus a',
    'manual false-negative spot-check. Running /org-retro <mode> logs a retro event, which',
    'self-clears this reminder until the next window.',
  ];
  process.stdout.write(JSON.stringify({ additionalContext: lines.join('\n') }));
  process.exit(0);
} catch {
  process.exit(0); // fail open — a hook bug must never block a session
}
