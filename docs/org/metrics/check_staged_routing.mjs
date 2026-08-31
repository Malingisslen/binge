// Refuses a commit whose STAGED files route to a role that no `review` row names.
//
// `--message <file>`  — COMMIT TIME. The only mode. Wired into lefthook's `commit-msg`
//                       list beside `check_review_coverage.mjs`.
//
// BIN-1059. Which reviewers a change owes is decided by which files it touches. The sprint
// routes the file set ONCE, at selection, and then the set moves: a ticket is dropped, a
// critique widens the scope, a fix pulls in a neighbour. The router is never re-run, and the
// wrong role critiques the batch. It has happened — BIN-1050/1048 (the selection routed [25];
// a ticket was pulled and the SHRUNK union routes [4]), BIN-938/1052 (a whole delivery sat in
// a third file that flips the panel from #14 to #25), and BIN-766 (a critique's binding
// condition pulled in firestore.rules and turned medium into top). It cannot be held by
// memory.
//
// WHY `commit-msg` AND NOT `pre-commit`. lefthook runs `pre-commit` first, and at that point
// the commit message does not exist — so nothing there can know WHICH tickets the commit is
// for, and the review rows are keyed by ticket. The subject line is the evidence, exactly as
// it is for the sibling check. The staged files are readable in both phases; the ticket ids
// are not.
//
// WHAT THIS DOES NOT DO. It never asks whether a review row EXISTS — that is
// `check_review_coverage.mjs`, which runs beside it and owns the silence case. This one
// grades only the ROLES: given rows that exist, does their panel cover what the staged files
// route to. A commit whose tickets have no rows at all passes here, so the two messages never
// compete to explain the same failure. Whether the sibling refuses it instead depends on that
// check's own commit-type list — read it there.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEvents, ticketOf } from './check_events.mjs';
import { ticketsInSubject, stagedEventsLog, REPO_ROOT } from './check_review_coverage.mjs';
import { route, ROLE_TITLES } from '../route.mjs';

/**
 * Paths excluded from the routed union, and why.
 *
 * BIN-1059 asked for this to be DECIDED rather than left to chance, on the premise that the
 * router answers differently depending on whether reviewers' own knowledge files are counted.
 * Measured before building, that premise does not hold: a `*.knowledge.md` is not a code path,
 * so it lands in the router's `unmapped` array rather than seating a role. Derive it —
 *
 *     node docs/org/route.mjs .claude/agents/binge-test-reviewer.knowledge.md
 *     node docs/org/route.mjs lefthook.yml .claude/agents/binge-test-reviewer.knowledge.md
 *     node docs/org/route.mjs lefthook.yml
 *
 * The exclusion stands on a reason that does not depend on today's ownership map:
 * a reviewer writes to its own knowledge file AS PART OF reviewing, so the union would then
 * describe the review rather than the change under review. If a future map ever made such a
 * path routable, this filter is what keeps the act of reviewing from moving who owed it.
 *
 * A reviewer's INSTRUCTION file (`.claude/agents/binge-*-reviewer.md`) is deliberately NOT
 * excluded — that is a gated surface in `reviewGates`. `stagedRoutingUnion` applies this and
 * the tests pin both directions.
 */
export const REVIEWER_ARTIFACT = /^\.claude\/agents\/.*\.knowledge(\.archive)?\.md$/;

/** The staged paths the router is asked about. */
export function stagedRoutingUnion(stagedPaths) {
  return stagedPaths.filter((p) => p && !REVIEWER_ARTIFACT.test(p));
}

/**
 * Role numbers out of one row's `panel`, whichever of the two shapes it is written in.
 *
 * Measured over the log rather than assumed: `panel` is a number array on some rows
 * (`[25]`, `[27,4,6]`) and a STRING array on others (`["#25 Engineering Manager / Release
 * Manager"]`); a few rows carry an empty array and one carries no `panel` at all. Both
 * shapes are honest records of the same thing. A comparison that read only the numeric one
 * would refuse every commit whose ticket was logged in the other — a gate that fires on the
 * log's formatting rather than on the change is a gate that gets switched off.
 *
 * Derive the mix rather than trusting this paragraph:
 *
 *     node -e "const fs=require('fs');const c={};for(const l of fs.readFileSync('docs/org/metrics/events.jsonl','utf8').split(/\r?\n/)){if(!l)continue;const o=JSON.parse(l);if(o.type!=='review')continue;const p=o.panel;const k=Array.isArray(p)?(p.length?typeof p[0]:'empty'):'missing';c[k]=(c[k]||0)+1}console.log(c)"
 */
export function panelNumbers(panel) {
  if (!Array.isArray(panel)) return [];
  const out = [];
  for (const entry of panel) {
    if (typeof entry === 'number' && Number.isInteger(entry)) { out.push(entry); continue; }
    if (typeof entry !== 'string') continue;
    const m = entry.match(/\d+/);
    if (m) out.push(Number(m[0]));
  }
  return out;
}

/** Every role number logged across the `review` rows belonging to `tickets`. */
export function loggedPanel(rows, tickets) {
  const wanted = new Set(tickets);
  const seen = new Set();
  let rowsFound = 0;
  for (const row of rows) {
    if (row.type !== 'review') continue;
    const ids = new Set();
    const id = ticketOf(row);
    if (id) ids.add(id);
    if (Array.isArray(row.tickets)) for (const t of row.tickets) if (typeof t === 'string') ids.add(t);
    if (![...ids].some((t) => wanted.has(t))) continue;
    rowsFound += 1;
    for (const n of panelNumbers(row.panel)) seen.add(n);
  }
  return { roles: [...seen].sort((a, b) => a - b), rowsFound };
}

/**
 * @returns {{ok: boolean, reason: string, tickets: string[], paths: string[],
 *          tier: string, routed: number[], logged: number[], missing: number[],
 *          roleTitles: Map<number, string>}}
 */
export function gradeStagedRouting({ subject, stagedPaths, rows }) {
  const tickets = ticketsInSubject(subject);
  const paths = stagedRoutingUnion(stagedPaths);
  const base = { tickets, paths, tier: 'n/a', routed: [], logged: [], missing: [], roleTitles: new Map() };

  if (tickets.length === 0) return { ...base, ok: true, reason: 'the subject names no ticket' };
  if (paths.length === 0) return { ...base, ok: true, reason: 'nothing is staged that the router reads' };

  const routing = route(paths);
  const routed = [...new Set(panelNumbers(routing.panel))].sort((a, b) => a - b);
  // The fallback seat is never in `roles` — nothing matched it, the router invented it — so
  // a message built from `roles` alone would name it `#14` and nothing else. That is the
  // common medium case, not a corner: most unowned code routes there.
  const roleTitles = new Map([
    ...Object.entries(ROLE_TITLES).map(([num, title]) => [Number(num), title]),
    ...(routing.roles ?? []).map((r) => [r.num, r.title]),
  ]);
  const { roles: logged, rowsFound } = loggedPanel(rows, tickets);

  if (routed.length === 0) {
    return { ...base, ok: true, reason: `the staged files route to tier "${routing.tier}" — no role owed`, tier: routing.tier, logged, roleTitles };
  }
  // The absence of any row is the sibling check's question, and answering it here too would
  // give one failure two voices that disagree about the remedy.
  if (rowsFound === 0) {
    return { ...base, ok: true, reason: 'no review row for these tickets — this check grades roles, not their absence', tier: routing.tier, routed, roleTitles };
  }

  const loggedSet = new Set(logged);
  const missing = routed.filter((n) => !loggedSet.has(n));
  return {
    ...base,
    ok: missing.length === 0,
    reason: missing.length === 0 ? 'every routed role is named by a logged review row' : 'a routed role is named by no review row',
    tier: routing.tier,
    routed,
    logged,
    missing,
    roleTitles,
  };
}

/** The staged file list, as git sees it right now. */
export function readStagedPaths(repoDir = REPO_ROOT) {
  const raw = execFileSync('git', ['diff', '--cached', '--name-only'], {
    cwd: repoDir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });
  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** Lines a blocked committer reads. Named as its own function so the tests can read them. */
export function refusalLines(verdict) {
  const named = verdict.missing.map((n) => `#${n} ${verdict.roleTitles.get(n) ?? 'role'}`);
  return [
    `staged routing: refusing this commit — ${verdict.reason}.`,
    '',
    `  tickets:      ${verdict.tickets.join(', ')}`,
    `  routed panel: [${verdict.routed.join(', ')}]  (tier ${verdict.tier})`,
    `  logged panel: [${verdict.logged.join(', ')}]`,
    `  NOT REVIEWED: ${named.join(', ')}`,
    '',
    'The staged files route to a role that no `review` row for these tickets names. That is',
    'BIN-1059: the panel was decided on a file set that has since moved. Reproduce it with',
    '',
    `  node docs/org/route.mjs ${verdict.paths.join(' ')}`,
    '',
    'Then either convene the missing role\'s blind critique and log a row naming it, or commit',
    'the files SPLIT so each commit routes to the critique that actually ran. Do not widen the',
    'logged panel to match — the row records who reviewed, not who should have.',
  ];
}

/** The `--message <file>` entry point. */
export function mainMessage(messagePath) {
  const subject = (readFileSync(messagePath, 'utf8').split(/\r?\n/)[0] ?? '').trim();
  const log = stagedEventsLog();
  const verdict = gradeStagedRouting({
    subject,
    stagedPaths: readStagedPaths(),
    rows: parseEvents(log.text),
  });

  if (verdict.ok) {
    if (verdict.routed.length > 0) {
      console.log(`staged routing: [${verdict.routed.join(', ')}] — ${verdict.reason} (read from ${log.source}).`);
    }
    return 0;
  }
  for (const line of refusalLines(verdict)) console.error(line);
  return 1;
}

// Entry-point guard: without it the CLI runs at import, eats the test runner's argv and exits
// the process, and the symptom is vitest hanging with no output at all (BIN-802).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const flag = process.argv.indexOf('--message');
  if (flag === -1) {
    console.error('usage: node docs/org/metrics/check_staged_routing.mjs --message <file>');
    process.exit(2);
  }
  process.exit(mainMessage(process.argv[flag + 1]));
}
