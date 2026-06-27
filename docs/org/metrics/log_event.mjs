#!/usr/bin/env node
// log_event.mjs — append-only logger for the role-org measurement layer.
//
// FAILS OPEN: this must NEVER throw to its caller. Logging is observability, not a
// dependency — if anything goes wrong it swallows the error and exits 0, so a broken
// log can never break a /stakeholder-review run or the ExitPlanMode hook.
//
// Usage:  node docs/org/metrics/log_event.mjs <type> '<json-payload>'
//   <type>     one of: review | trigger | world-watch | freshness | retro
//   <payload>  optional JSON object string with type-specific fields
//
// Stamps an ISO-UTC `ts` and appends ONE JSON line to events.jsonl (next to this file,
// resolved from the script's own dir so cwd doesn't matter). Cross-platform (Node).
// See README.md for the event schema.

import { appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const type = process.argv[2];
  if (!type) process.exit(0); // nothing to log → fail open

  let payload = {};
  if (process.argv[3]) {
    try { payload = JSON.parse(process.argv[3]); }
    catch { payload = { raw: String(process.argv[3]) }; } // never throw on bad JSON
  }

  const event = { ts: new Date().toISOString(), type, ...payload };
  const file = join(dirname(fileURLToPath(import.meta.url)), 'events.jsonl');
  appendFileSync(file, JSON.stringify(event) + '\n');
} catch {
  // swallow — logging must never break a caller
}
process.exit(0);
