// A published command must name the database it opens (BIN-1122).
//
// Run: npm test (via check-published-commands.test.mjs), or `node scripts/check-published-commands.mjs`
//
// WHY THIS EXISTS, and why the floor one directory over was not enough. BIN-1107 made every
// tracked script under `functions/scripts/` name its Firebase project, and put a
// source-scanning floor beside it so a new script that forgets is caught. That floor reads
// `git ls-files -- functions/scripts`. A command written into a RUNBOOK reaches it never.
//
// Two such commands were then found by hand, in two separate sweeps, and the second sweep
// existed only because the first one's author had written that the first was exhaustive:
//
//   * an inline `node -e` in a recap runbook that opened a Firestore under
//     application-default credentials and DELETED a document. An operator with the wrong
//     ambient credentials would have deleted from another project's database and been told
//     `deleted`.
//   * a `gcloud firestore import` that RESTORES a whole database, in a block where a sibling
//     invocation named the project and this one did not.
//
// The second sweep missed the second one for a structural reason worth keeping: it was
// keyed on `applicationDefault()`, and the gcloud family does not contain that expression
// anywhere. A check that knows one command family is the same defect as a check that knows
// one directory. So this reads the FORM of a command that opens a Firestore, on both
// families, rather than a list of the places one has been found.
//
// WHAT IT READS, and the part that took a role critique to get right: only FENCED CODE
// BLOCKS. Prose that describes the hazard names the same expressions — `tasks/lessons.md`
// carries the lesson that produced this file, and the reviewer knowledge files carry the
// finding — and a whole-file scan flags them. The first design answered that
// with a list of exempt filenames, which is a list that drifts the first time someone
// writes another warning somewhere new. Reading only fenced blocks makes the exemption
// structural instead: there is no list to maintain and no file to forget.
//
// The cost of that choice is stated below rather than argued away — commands DO appear
// inline in prose in this repo, and those are unread here.
//
// It reads the files git TRACKS. Untracked scratch on a developer's disk is outside what a
// commit can fix, and a guard that went red on it would be red for a reason no change could
// clear — the same reasoning BIN-1107's floor states for its own set.
//
// WHAT IT DOES NOT SEE, stated so nobody reads it as total coverage. A published command that
// INVOKES one of the scripts under `functions/scripts/` opens a Firestore without containing
// either form this file matches, so it is invisible here. That is not the same hole: those
// scripts refuse to run without `--project` themselves, which is what BIN-1107 built and what
// its own floor keeps true. The protection is real but it lives there, not here. Likewise a
// command outside a fence is deliberately unread (see above), an untracked file is out of
// scope, and none of this reaches an operator who mistypes a project id that the document
// spells correctly.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A fence opens and closes on a line whose first non-space characters are three or more
// backticks or tildes. The closing fence must be at least as long as the opener, which is
// what lets a block contain a shorter run of backticks — a command holding an inline
// backtick pair is ordinary.
const FENCE = /^[ \t]*(`{3,}|~{3,})/;

export function fencedBlocks(text) {
  const blocks = [];
  let open = null;
  let buf = [];
  for (const line of text.split(/\r?\n/)) {
    const m = FENCE.exec(line);
    if (open === null) {
      if (m) { open = m[1]; buf = []; }
      continue;
    }
    if (m && m[1][0] === open[0] && m[1].length >= open.length) {
      blocks.push(buf.join('\n'));
      open = null;
      continue;
    }
    buf.push(line);
  }
  // An unterminated fence still holds whatever followed it; dropping it would let a command
  // hide behind a missing close.
  if (open !== null) blocks.push(buf.join('\n'));
  return blocks;
}

// Joins backslash-continued shell lines, so a command split across rows is read as one.
// `gcloud firestore import \` with its flags on following lines is the shape that motivated
// this: read line-by-line, the invocation and its `--project` sit in different strings.
export function joinContinuations(block) {
  return block.replace(/\\[ \t]*\r?\n[ \t]*/g, ' ');
}

// The Admin SDK names the project inside the object passed to initializeApp. Scope the
// question to that object rather than to the surrounding text: BIN-1107's floor learned
// this the hard way twice, once on a file header that spelled out an unnamed call to
// explain itself, and again on a trailing comment sharing a line with code.
const INIT_CALL = /initializeApp\(\s*\{[^{}]*\}/g;

// gcloud names it in a flag. `firestore` may be preceded by global flags, so this does not
// require the two words to be adjacent — but it stops at a newline so a later, unrelated
// gcloud invocation in the same block is judged separately.
const GCLOUD_CALL = /\bgcloud\b[^\n]*?\bfirestore\b[^\n]*/g;

export function offendersIn(text) {
  const found = [];
  for (const raw of fencedBlocks(text)) {
    const block = joinContinuations(raw);

    for (const call of block.match(INIT_CALL) ?? []) {
      if (!call.includes('applicationDefault()')) continue;
      if (!call.includes('projectId')) found.push({ family: 'admin-sdk', call: call.trim() });
    }
    // A call whose argument is not an inline object literal is unreadable from here, so it
    // is named rather than waved through — the safe direction for this guard is a false
    // alarm on an unusual but correct command, never silence over an unnamed project.
    const readable = (block.match(INIT_CALL) ?? []).length;
    const calls = (block.match(/initializeApp\(/g) ?? []).length;
    if (calls > readable) found.push({ family: 'admin-sdk', call: 'initializeApp( — argument not readable' });

    for (const call of block.match(GCLOUD_CALL) ?? []) {
      if (!/--project\b/.test(call)) found.push({ family: 'gcloud', call: call.trim() });
    }
  }
  return found;
}

// The one exemption, and it is a CLASS rather than a list of filenames. A reviewer's
// knowledge record exists to quote the defect it found, verbatim and in a fenced block so a
// later reader can recognise the shape — including, here, unnamed `initializeApp` calls
// reproduced as evidence from the very ticket that produced this check. Reading fenced
// blocks only was expected to make every exemption unnecessary; it does not, and this is the
// measured exception rather than an assumed one.
//
// Anchored to the agents directory, not just the suffix. A bare suffix would silence any
// future file anywhere in the tree that happened to end this way — a `docs/ops/*.knowledge.md`
// holding a real restore command would be exempted for a reason nobody chose. Held to a
// pattern rather than a list of the six that exist today, so a new reviewer's records are
// covered without anyone remembering to add them.
const REVIEWER_RECORD = /^\.claude\/agents\/.*\.knowledge(\.archive)?\.md$/;

// Exported so the anchor can be pinned directly. Reaching it through `trackedMarkdown` only
// proves the suffix half, because no path outside the agents directory carries that suffix
// today — so the anchor could be dropped with the whole suite green, which is exactly what
// the paragraph above says must not happen.
export const isReviewerRecord = (path) => REVIEWER_RECORD.test(path);

export function trackedMarkdown({ dir = REPO_ROOT } = {}) {
  return execFileSync('git', ['ls-files', '--', '*.md'], { cwd: dir, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !isReviewerRecord(f));
}

// `read` is injected so a test can drive this over its own fixtures without touching the
// repo, and defaults to the real tree so the shipped run measures what actually ships.
export function findOffenders({ files, dir = REPO_ROOT, read } = {}) {
  const list = files ?? trackedMarkdown({ dir });
  const readFile = read ?? ((rel) => readFileSync(join(dir, rel), 'utf8'));
  const out = [];
  for (const rel of list) {
    for (const hit of offendersIn(readFile(rel))) out.push({ file: rel, ...hit });
  }
  return out;
}

// `offenders` is injectable for the same reason `read` is, and for one specific test: the
// failure branch. Called bare against a clean tree, `main()` can only ever reach the success
// return, so `return 1` could become `return 0` — the check reporting success over every
// offender it finds — with the whole suite green.
export function main({ offenders: given } = {}) {
  const offenders = given ?? findOffenders();
  if (offenders.length === 0) {
    console.log('published commands: OK');
    return 0;
  }
  for (const o of offenders) console.error(`${o.file}: [${o.family}] ${o.call}`);
  console.error(`\n${offenders.length} published command(s) open a Firestore without naming a project.`);
  return 1;
}

// Guarded so importing this module from a test does not run the CLI. An unguarded CLI eats
// the runner's argv and exits the process, and the symptom is vitest hanging with no output
// rather than an error (BIN-802).
//
// `pathToFileURL`, not a hand-built `file://` string: on Windows the real URL is
// `file:///C:/…` and a hand-built one is `file://C:/…`, so the comparison is false on every
// run and the CLI silently never fires. The first version of this line had that bug, and it
// exits 0 printing nothing — indistinguishable from a healthy run that found no offender.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
