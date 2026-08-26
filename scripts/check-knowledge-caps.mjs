// A WARNING, not a gate: reports reviewer knowledge files that have outgrown the cap they
// declare (BIN-997). Malin's call 2026-08-25 — the cap is a recommendation a warning
// reminds you of, not a mechanism that reddens a build. The cap had been decoration:
// files sat over it while every gate stayed green.
//
// (A count stood here — "two of the three" — and is struck. It depends on which bytes you
// count: git stores these LF and this script reads them off a CRLF worktree, and the
// margin was smaller than the difference. Derive it if you need it; do not restate it.)
//
// So this exits 0 on an overrun, on purpose. What it does NOT do quietly is disappear:
// finding FEWER files than the floor exits non-zero, because a glob that stops matching
// looks exactly like a clean run (BIN-838/850/852 — a zero-match check exits 0 having
// checked nothing). The floor is asserted for real by check-knowledge-caps.test.mjs under
// `npm test`; this script carries it too so a direct invocation cannot be fooled either.
//
// WHERE IT RUNS. .github/workflows/deploy.yml already carries the weekly sweep
// (`schedule: cron '0 4 * * 1'`). The step added there is gated on that event and marked
// `continue-on-error`, so it fires once a week and can never red a deploy — which is the
// literal shape of the decision. `npm run check:knowledge-caps` runs it by hand.
//
// A check nothing invokes is a decorative floor; that was #25's blocking condition on
// this ticket, and naming the invocation point is what discharged it.
//
// No shebang line, deliberately: vitest's shebang stripper is LF-only and this repo is
// CRLF, so a shebang here is what BIN-891's parse failure collides with.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const AGENTS_DIR = join(REPO_ROOT, '.claude', 'agents');

/**
 * The cap, in characters.
 *
 * NOT the only reader of these files. The workflow-guards `knowledge-freshness` Stop hook
 * walks the same glob and warns on its own limit, configured at
 * `.claude/shared-plugin.json` → `knowledge.sizeLimitChars`. Change one and you must change
 * the other by hand, or the hook keeps warning at the old value. Nothing enforces that.
 */
export const CAP_CHARS = 80_000;

// A floor under the file COUNT, so a glob that stops matching cannot read as "all clear".
// A LITERAL, deliberately not derived from what the directory happens to hold — a derived
// floor lowers in lockstep with the shrink it exists to catch (BIN-838, and the same
// reasoning as scripts-self-tests-present.test.mjs's MIN).
export const MIN_KNOWLEDGE_FILES = 3;

/**
 * The live knowledge files: `*.knowledge.md` under .claude/agents, never the
 * `*.knowledge.archive.md` beside them. The archives are the overflow this cap creates
 * and carry no cap of their own by design, so a looser `*knowledge*.md` would warn about
 * exactly the files the rule tells you to grow.
 */
export function knowledgeFiles(dir = AGENTS_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.knowledge.md'))
    .sort()
    .map((name) => ({ name, chars: readFileSync(join(dir, name), 'utf8').length }));
}

export function report(files, cap = CAP_CHARS) {
  return files
    .filter((f) => f.chars > cap)
    .map((f) => `${f.name}: ${f.chars} chars, cap ${cap} (over by ${f.chars - cap})`);
}

export function main() {
  const files = knowledgeFiles();

  if (files.length < MIN_KNOWLEDGE_FILES) {
    console.error(
      `check-knowledge-caps: found ${files.length} *.knowledge.md file(s) under ` +
        `.claude/agents, floor is ${MIN_KNOWLEDGE_FILES}. Either the files moved or the ` +
        `glob stopped matching — this check was measuring nothing.`,
    );
    return 1;
  }

  const over = report(files);
  if (over.length === 0) {
    console.log(`check-knowledge-caps: ${files.length} file(s), all within ${CAP_CHARS} chars.`);
    return 0;
  }

  // `::warning::` so a scheduled run produces an annotation on the run summary rather than
  // a line buried in a 175-minute log. The two sibling advisory steps in deploy.yml (the
  // npm-audit step, BIN-344, and the RSC-twin step) already do this for the same reason:
  // an advisory nobody sees is the same as no advisory. Harmless outside Actions.
  console.warn(
    `::warning::check-knowledge-caps: ${over.length} of ${files.length} reviewer knowledge ` +
      `file(s) over the ${CAP_CHARS}-char cap — ${over.join('; ')}`,
  );
  for (const line of over) console.warn(`  ${line}`);
  console.warn(
    '  Pay for the overrun with a cut: move the oldest entries verbatim into the ' +
      '*.knowledge.archive.md beside the file. Nothing is deleted. (Warning only — BIN-997.)',
  );
  return 0;
}

// Guard the CLI behind an entry-point check: a script whose CLI runs at import eats the
// test runner's argv and exits the process, and the symptom is vitest hanging with no
// output rather than an error (BIN-802).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
