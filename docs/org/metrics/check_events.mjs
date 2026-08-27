// check_events.mjs — fails when a row in events.jsonl claims the code reached main
// without naming the evidence for that claim. Filed as BIN-918.
//
// WHY THIS EXISTS
// The unattended sprint writes its `review` rows in the SELECTION step, before anything is
// built, but phrases them in the past tense. Four rows stamped 2026-08-16T13:53:30.297Z say
// "BUILT and committed". The earliest of those commits (049f21b) is authored 14:32:45Z, 39
// minutes later; the other two tickets landed in 851696d at 15:25:30Z, 92 minutes later;
// and the fourth (BIN-909) was never built at all. This log is the evidence trail for which
// reviews were skipped, so a row asserting a build it cannot have witnessed is worse than
// no row.
//
// (Those figures were themselves wrong in the first draft of this file — 15:25 and 92
// minutes were written for all of them, conflating the two commits. Caught by the code
// review before commit. Worth leaving on the record: an unchecked number written into the
// fix for unchecked numbers is the same defect one level up, and it took a reader who
// resolved the shas rather than trusting the prose.)
//
// THE RULE: a claim that the work reached main must carry its evidence.
// A `review` row asserting a commit — via `outcome: "declined-unattended-shipped"`, or an
// un-negated commit phrase in its prose — must carry a `commit_sha`. No sha, no claim.
// When a sha IS named, it must exist and must NOT be newer than the row: a row can only
// truthfully say "this reached main as commit X" if X already existed when the row was
// written. (Direction matters and is easy to invert — `commit_ts <= row_ts` passes,
// `commit_ts > row_ts` fails. Both directions are pinned by fixtures in the test file,
// because neither of the four known-bad rows reaches this check: they fail earlier on the
// missing field, so an inverted comparison would otherwise ship green forever.)
//
// WHAT A CLEAN RUN DOES **NOT** MEAN — read this before citing it as proof of anything.
// A clean run means no unevidenced claim STANDS. That is weaker than "every claim is
// evidenced", and the output separates the ways a claim can stop standing: evidenced,
// retired by a correction (retracted, not verified), grandfathered, or unverifiable in a
// shallow checkout. As of this commit the live file scores 0 evidenced and 4 retired —
// printing that as "clean" without the breakdown would be this file committing the
// overclaim it exists to catch (integration review, third pass).
// It also does NOT verify that the named commit actually contains that ticket's work. A
// real sha cited for the wrong ticket, or a docs-only commit cited for a code claim, is
// invisible here. That is the same failure class that sank the first attempt at this check
// (which matched commit SUBJECT LINES and therefore certified a docs commit for a code
// claim). The difference is that this design refuses the inference outright and discloses
// where verification stops, rather than guessing and being wrong.
//
// CORRECTIONS. events.jsonl is append-only (README), so a false row is never edited. A
// later `{"type":"correction","corrects":{"ts":…,"ticket":…}}` row retires it, and this
// check treats a corrected row as resolved. The key is `{ts, ticket}` and deliberately NOT
// `commit_sha`: the row most in need of correction is the one that never had a commit.
//
// Run:  node docs/org/metrics/check_events.mjs
// Exit: 0 clean, 1 violations (listed on stderr).

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVENTS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'events.jsonl');

/**
 * The outcome value that, on its own, asserts the code reached main. It is a structured
 * field rather than prose, so it needs no matching — see README's `ran: false` section.
 */
export const SHIPPED_OUTCOME = 'declined-unattended-shipped';

/**
 * The rule takes effect from the incident it was filed about — the four rows stamped
 * 2026-08-16T13:53:30.297Z. Rows written before it predate the requirement and are
 * grandfathered rather than retro-demanded: e.g. the 2026-06-29 row truthfully says
 * "shipped blockeringar fix only" and simply comes from a time when no sha was recorded.
 * Its claim is not false, so failing it would be noise, and noise is how a check gets
 * switched off. The count of grandfathered claims is PRINTED on every run — a bounded,
 * visible exemption, never a silent one.
 */
export const RULE_EFFECTIVE_FROM = '2026-08-16T00:00:00.000Z';

/**
 * Phrases that assert the work reached MAIN.
 *
 * Deliberately not "built": seven honest rows say "built in a worktree; NOT committed,
 * NOT pushed", and a check keyed on the word "built" would fail every one of them.
 * Reaching main is the claim that needs evidence; being built is not.
 *
 * Deliberately not "merged" either. It was in this list for one run and misfired on a real
 * row — BIN-813's "22 merged binding conditions", where what was merged is CONDITIONS, not
 * code. A pattern that has been observed to produce a false positive on live data does not
 * get kept with a caveat; it gets removed.
 */
const CLAIM_PATTERNS = [/\bcommitted\b/i, /\bpushed\b/i, /\bshipped\b/i];

/**
 * A claim immediately preceded by a negator is not a claim — "NOT committed, NOT pushed"
 * is the honest worktree row. The window is short on purpose: a negator four words back
 * usually governs a different clause, and widening it starts excusing real claims.
 */
const NEGATOR = /\b(no|not|never|nothing|neither|nor|without|inte|aldrig|inget|utan)\b[^.;]{0,12}$/i;

/** Prose fields a writer may put the claim in. Both are live in the file today. */
export function proseOf(row) {
  return [row.plan, row.note].filter(t => typeof t === 'string').join(' — ');
}

/** True when the prose asserts, un-negated, that the work reached main. */
export function claimsReachedMain(prose) {
  for (const pattern of CLAIM_PATTERNS) {
    const match = pattern.exec(prose);
    if (match && !NEGATOR.test(prose.slice(0, match.index))) return true;
  }
  return false;
}

/**
 * The ticket id, for keying corrections. ANCHORED to the start of the prose on purpose:
 * the rejected first attempt took any BIN-id it found anywhere, so a prose token before
 * the id (ISO-8601, UTF-8, ADR-0021) was read as the ticket. Anchoring makes that
 * structurally impossible — anything else yields null and is reported, loudly, as
 * uncorrectable.
 *
 * This is a BACKFILL bridge for rows written before `ticket` was stamped. Going forward
 * `ticket` is a real field; do not let this become the normal way the id is obtained.
 */
export function ticketOf(row) {
  if (typeof row.ticket === 'string' && row.ticket) return row.ticket;
  // A few early rows use a `tickets` ARRAY instead. One name, two spellings — the same
  // schema drift README already documents for `mustHaves`/`tier`/`panel`. Single-entry
  // arrays are unambiguous; a multi-entry one is not a key and falls through.
  if (Array.isArray(row.tickets) && row.tickets.length === 1) return row.tickets[0];
  const anchored = /^(BIN-\d+)\b/.exec(proseOf(row).trim());
  return anchored ? anchored[1] : null;
}

/**
 * JSON rather than string concatenation: it cannot be made ambiguous by a separator
 * appearing inside either half, and it survives a malformed ticket id without silently
 * collapsing two different rows onto one key.
 */
function correctionKey(ts, ticket) {
  return JSON.stringify([ts, ticket]);
}

/**
 * @param rows   parsed events, in file order
 * @param resolveCommit  (sha) => ISO date string, or null when the sha does not exist.
 *                       Injected so the tests never touch git.
 * @param opts.historyAvailable  false in a SHALLOW clone, where no historical sha can be
 *          resolved. Then the two pure rules (a claim must carry a sha; it must look like
 *          one) still apply, and the existence/freshness lookup is recorded as UNVERIFIED
 *          rather than silently answered "does not exist". Those are three different
 *          states and must never collapse into one: a SHALLOW checkout sits at
 *          depth 1, so without this every honest row would fail there while the same row
 *          passed on `deploy.yml` (fetch-depth 0) and locally. The check would then punish
 *          the first writer who obeyed it — which is how a check gets switched off.
 * @returns {{violations: object[], claimsChecked: number, evidenced: number,
 *          correctedAway: number, grandfathered: number, unverified: number}} — the counts
 *          travel WITH the verdict rather than as properties hung on the array, so "clean",
 *          "checked nothing" and "could not check" can never read the same to a caller.
 *          `claimsChecked` is the total; the other four are the ways a claim stops
 *          standing, and they sum to it only when `violations` is empty. Do NOT re-derive
 *          `evidenced` by subtracting the others — that shape shipped for one round and
 *          was wrong, because it never subtracted the violations.
 */
export function findViolations(rows, resolveCommit, { historyAvailable = true } = {}) {
  const corrected = new Set();
  for (const row of rows) {
    if (row.type !== 'correction' || !row.corrects) continue;
    const { ts, ticket } = row.corrects;
    if (ts && ticket) corrected.add(correctionKey(ts, ticket));
  }

  const violations = [];
  let claimsChecked = 0;
  let grandfathered = 0;
  let unverified = 0;
  let correctedAway = 0;
  let evidenced = 0;

  for (const row of rows) {
    if (row.type !== 'review') continue;
    if (row.outcome !== SHIPPED_OUTCOME && !claimsReachedMain(proseOf(row))) continue;

    if (Date.parse(row.ts) < Date.parse(RULE_EFFECTIVE_FROM)) { grandfathered++; continue; }

    claimsChecked++;
    const ticket = ticketOf(row);

    if (!ticket) {
      violations.push({
        ts: row.ts,
        ticket: null,
        reason: 'claims the work reached main but carries no `ticket` field and its prose '
          + 'does not start with a BIN-id, so no correction can ever be keyed to it',
      });
      continue;
    }
    // Retired by a correction. NOT the same as "evidenced" — counted separately so the
    // output cannot report four retracted claims as four verified ones.
    if (corrected.has(correctionKey(row.ts, ticket))) { correctedAway++; continue; }

    if (!row.commit_sha) {
      violations.push({ ts: row.ts, ticket, reason: 'claims the work reached main but names no `commit_sha`' });
      continue;
    }
    if (!/^[0-9a-f]{7,40}$/.test(row.commit_sha)) {
      violations.push({ ts: row.ts, ticket, reason: `\`commit_sha\` is not a sha: ${row.commit_sha}` });
      continue;
    }

    // A shallow checkout cannot answer "does this sha exist" for anything but the tip, so
    // it does not get to answer it at all. Counted and printed, never assumed either way.
    if (!historyAvailable) { unverified++; continue; }

    const commitDate = resolveCommit(row.commit_sha);
    if (!commitDate) {
      violations.push({ ts: row.ts, ticket, reason: `names commit ${row.commit_sha}, which does not exist in this repo` });
      continue;
    }
    // The row cannot have witnessed a commit that did not exist yet.
    if (Date.parse(commitDate) > Date.parse(row.ts)) {
      violations.push({
        ts: row.ts,
        ticket,
        reason: `names commit ${row.commit_sha} (${commitDate}), which is NEWER than the row itself `
          + '— the claim was written before the thing it claims',
      });
      continue;
    }

    // Survived every check. Counted HERE rather than derived as
    // `claimsChecked - correctedAway - unverified`, which was the first shape and was
    // wrong: it never subtracted the violations, so the one run where this check actually
    // fires reported the offending claim as "1 evidenced" on the line above the violation
    // it was reporting. Two tests derived it the same way, so nothing could catch it
    // (integration review, fourth pass).
    evidenced++;
  }

  // A floor. Zero claims examined means the shape changed or the read broke, and a silent
  // green is exactly how a check stops protecting anything without anyone noticing.
  if (claimsChecked === 0) {
    violations.push({
      ts: null,
      ticket: null,
      reason: 'examined ZERO in-scope reaching-main claims — the log shape changed or the read '
        + 'failed; this check is not currently protecting anything',
    });
  }

  return { violations, claimsChecked, grandfathered, unverified, correctedAway, evidenced };
}

export function parseEvents(text) {
  return text.split(/\r?\n/).filter(line => line.trim()).map((line, i) => {
    try { return JSON.parse(line); }
    catch { return { type: 'unparseable', ts: null, line: i + 1 }; }
  });
}

export function gitCommitDate(sha) {
  try {
    return execFileSync('git', ['show', '-s', '--format=%cI', sha], {
      cwd: dirname(EVENTS_PATH), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * True when this working copy holds full history. A shallow checkout sits at
 * the default depth 1, `deploy.yml` uses `fetch-depth: 0` — so the same row is verifiable
 * on one workflow and not on another, and the difference is invisible from a local run.
 */
export function historyIsAvailable() {
  try {
    return execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
      cwd: dirname(EVENTS_PATH), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() !== 'true';
  } catch {
    return false; // no git at all — treat as unverifiable, never as verified
  }
}

export function main() {
  const rows = parseEvents(readFileSync(EVENTS_PATH, 'utf8'));
  const historyAvailable = historyIsAvailable();
  const { violations, claimsChecked, grandfathered, unverified, correctedAway, evidenced } =
    findViolations(rows, gitCommitDate, { historyAvailable });
  const scope = `${claimsChecked} claim(s) checked — ${evidenced} evidenced, `
    + `${correctedAway} retired by a correction (retracted, NOT verified), `
    + `${grandfathered} grandfathered as written before ${RULE_EFFECTIVE_FROM}`
    + (unverified ? `, ${unverified} carrying a sha this SHALLOW checkout cannot resolve `
      + '(existence and freshness NOT verified here — deploy.yml checks out full history)' : '');
  if (violations.length === 0) {
    console.log(`events.jsonl: no unevidenced reaching-main claim stands — ${scope}.`);
    return 0;
  }
  console.error(`events.jsonl: ${violations.length} unevidenced claim(s) — ${scope}.\n`);
  for (const v of violations) {
    console.error(`  ${v.ts ?? '(whole file)'} ${v.ticket ?? ''} — ${v.reason}`);
  }
  console.error('\nA row may only say the work reached main if it names a commit_sha that exists');
  console.error('and is not newer than the row. Retire a false row with a `correction` event');
  console.error('keyed on {ts, ticket} — events.jsonl is append-only and never edited.');
  return 1;
}

// Entry-point guard: without it the CLI runs at import, eats the test runner's argv and
// exits the process, and the symptom is vitest hanging with no output at all (BIN-802).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
