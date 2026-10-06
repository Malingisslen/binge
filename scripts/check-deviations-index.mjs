// check-deviations-index.mjs — pre-commit check that the decided-deviations index lists
// exactly the ledger's entry headings, in the ledger's order.
//
// WHY THE SPLIT. The ledger (`.claude/accepted-deviations.md`) is long, and as a
// trigger-loaded rule it was read in full every time a session opened a file under src/,
// functions/ or the rules. The index at `.claude/rules/accepted-deviations.md` keeps the
// trigger and holds only the headings, so a reviewer sees which decisions exist and opens the
// ledger for the one that matches. An index that drifts from the ledger hides a decision from
// exactly that reviewer, so this check refuses the commit instead.
//
// WHAT COUNTS AS AN ENTRY HEADING: a line starting `## ` or `### [`, outside a ``` fence.
//
// It reads the STAGED copies (`git show :<path>`), which are what the commit will contain.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const LEDGER = '.claude/accepted-deviations.md';
export const INDEX = '.claude/rules/accepted-deviations.md';

// A literal, not derived from the ledger: a ledger that lost its headings, or a pattern that
// stopped matching them, would otherwise compare an empty list with an empty list and pass.
export const FLOOR = 60;

const ENTRY = /^(## |### \[)/;
const FENCE = /^```/;

export function entryHeadings(text) {
  const headings = [];
  let fenced = false;
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced && ENTRY.test(line)) headings.push(line);
  }
  return headings;
}

/** Why the index does not match the ledger, or `null` when it does. */
export function indexProblem(ledgerText, indexText, { floor = FLOOR } = {}) {
  const ledger = entryHeadings(ledgerText);
  if (ledger.length < floor) {
    return `${LEDGER} has ${ledger.length} entry headings, fewer than the floor of ${floor}; the check would measure nothing`;
  }
  const index = entryHeadings(indexText);
  const length = Math.max(ledger.length, index.length);
  for (let i = 0; i < length; i += 1) {
    if (ledger[i] === index[i]) continue;
    if (index[i] === undefined) return `${INDEX} is missing the ledger heading "${ledger[i]}" (entry ${i + 1})`;
    if (ledger[i] === undefined) return `${INDEX} lists "${index[i]}", which is not a heading in ${LEDGER}`;
    return `entry ${i + 1}: ${LEDGER} has "${ledger[i]}" but ${INDEX} has "${index[i]}"`;
  }
  return null;
}

function readStaged(path) {
  return execFileSync('git', ['show', `:${path}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function main({ read = readStaged, log = console.log, err = console.error } = {}) {
  let ledger;
  let index;
  try {
    ledger = read(LEDGER);
    index = read(INDEX);
  } catch (error) {
    err(`deviations index: could not read ${LEDGER} or ${INDEX}: ${error.message}`);
    return 1;
  }
  const problem = indexProblem(ledger, index);
  if (problem) {
    err(`deviations index: ${problem}.`);
    err(`Append a new entry to ${LEDGER} and copy its heading line, unchanged, to the end of ${INDEX}.`);
    return 1;
  }
  log(`deviations index: ${INDEX} lists every entry heading in ${LEDGER}, in order.`);
  return 0;
}

// Importing this file from a test must not run the CLI (BIN-802).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
