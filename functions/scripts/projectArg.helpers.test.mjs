// BIN-1107. The `--project` contract, tested by CALLING it.
//
// A source-scanning test is not enough for the refusal itself, and this repo has the
// receipt: a mutation that deleted `return 1;` from a refusal survived green because
// `toContain('return 1;')` matched a SIBLING branch in the same file. The assertions below
// drive the function and read its value, so the mutation that removes the refusal has
// nowhere to hide.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { projectFrom, projectRefusal } from './projectArg.helpers.mjs';

const HERE = join(fileURLToPath(import.meta.url), '..');
const REPO = join(HERE, '..', '..');

describe('projectFrom', () => {
  it('reads the id that follows --project', () => {
    expect(projectFrom(['--project', 'binge-nu'])).toBe('binge-nu');
    expect(projectFrom(['--dry-run', '--project', 'binge-nu', 'file.json'])).toBe('binge-nu');
  });

  it('is undefined when no --project is present', () => {
    expect(projectFrom([])).toBeUndefined();
    expect(projectFrom(['--apply', 'file.json'])).toBeUndefined();
  });

  // The whole reason this is a function and not a bare `argv[i + 1]`. `--apply --project`
  // reads the NEXT FLAG as the value, and the run is then aimed at a project literally
  // called `--apply`. A flag is never an id.
  it('refuses to read a following FLAG as the project id', () => {
    expect(projectFrom(['--project', '--apply'])).toBeUndefined();
    expect(projectFrom(['--apply', '--project'])).toBeUndefined();
    expect(projectFrom(['--project'])).toBeUndefined();
  });
});

describe('projectRefusal', () => {
  it('refuses a run that names no project', () => {
    const why = projectRefusal(['--apply']);
    expect(typeof why).toBe('string');
    expect(why).toContain('--project');
  });

  it('refuses when the value position holds a flag', () => {
    expect(projectRefusal(['--apply', '--project'])).toContain('--project');
  });

  it('lets a run with a named project through', () => {
    expect(projectRefusal(['--project', 'binge-nu', '--apply'])).toBeNull();
  });
});

// The contract EXISTS above; this is whether it RUNS. Both assertions were needed, and the
// gap between them was live: the refusal block could be deleted from either script with the
// whole suite green — 4783 tests, 281 files, no signal — because the helper's own tests only
// prove the helper, and the argument scan only proves the text inside `initializeApp(...)`.
// Neither reaches `main()`. That is BIN-776's class: a check wired into nothing is a check
// that does not run.
//
// The block is anchored as ONE regex through the EXIT, following the idiom
// backfill-mirror-uid.helpers.test.mjs already uses. Anchoring the condition alone is
// satisfied while the body is deleted, and anchoring `projectRefusal(` alone is satisfied by
// the import line.
describe('the refusal is wired into every script that opens a Firestore', () => {
  // Every tracked caller, INCLUDING the one whose wiring is also covered by its own
  // sibling test. An earlier version named two of the three and called itself 'every',
  // which invites a maintainer to read the roster as exhaustive and delete the sibling as
  // redundant — reopening the hole with nothing left to catch it. The refusal helper and
  // the exit differ between them, so each entry carries its own.
  const WIRED = [
    ['recap-upload.mjs', 'projectRefusal\\(args\\)', 'console\\.error\\(refusal\\); process\\.exit\\(1\\);'],
    ['recap-coverage-manifest.mjs', 'projectRefusal\\(argv\\)', 'console\\.error\\(refusal\\); process\\.exit\\(1\\);'],
    ['backfill-mirror-uid.mjs', 'refusalFor\\(argv\\)', 'console\\.log\\(refusal\\);\\s*return 1;'],
  ];

  // A roster floor OUTSIDE the loop. `it.each([])` registers nothing and reports PASS, so a
  // halved or emptied list would silence this block without failing anything. The number is
  // a LITERAL: deriving it from WIRED.length sinks in lockstep and can never fail.
  it('names every tracked script that opens a Firestore', () => {
    const callers = execFileSync('git', ['ls-files', '--', 'functions/scripts'], {
      cwd: REPO,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
      .filter((f) => readFileSync(join(REPO, f), 'utf8').includes('applicationDefault()'))
      .map((f) => basename(f))
      .sort();
    expect(callers).toEqual(WIRED.map(([name]) => name).sort());
    expect(WIRED.length).toBe(3);
  });

  it.each(WIRED)('%s refuses and exits before opening Firestore', (name, call, exit) => {
    const src = readFileSync(join(REPO, 'functions', 'scripts', name), 'utf8');
    // Anchored as ONE regex THROUGH the exit. An anchor on the condition alone is satisfied
    // while the body is deleted, and an anchor on the helper name alone is satisfied by the
    // import line.
    //
    // Known residual, the same one backfill-mirror-uid.helpers.test.mjs and BIN-808's
    // workflow-map guard already accept: a source scan proves the text is PRESENT, never
    // that it runs. A verbatim copy parked under `if (false)` satisfies this. Closing that
    // needs the script to be callable from a test, which it is not — it imports
    // firebase-admin, which the root install does not provide.
    expect(src).toMatch(new RegExp(`const refusal = ${call};\\s*if \\(refusal\\)\\s*\\{\\s*${exit}`));
  });
});

// Every script here that opens a Firestore must name its project. This one IS a source scan,
// deliberately: only a scan notices a NEW script arriving with an unnamed initializeApp, and
// that is exactly how the third offender turned up after two were already written on the
// ticket. The set is DERIVED, never listed — a list here would go stale the first time a
// script is added, which is the failure this check exists to catch.
//
// It reads the files git TRACKS, not the directory. Untracked scratch on a developer's disk
// is outside what this repo can promise anything about, and a guard that failed on it would
// be red for a reason no commit could fix.
describe('no tracked script opening Firestore under an application-default credential leaves its project unnamed', () => {
  it('every initializeApp call that uses applicationDefault also names projectId', () => {
    const tracked = execFileSync('git', ['ls-files', '--', 'functions/scripts'], {
      cwd: REPO,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'));

    expect(tracked.length).toBeGreaterThan(0);

    const offenders = [];
    for (const rel of tracked) {
      const src = readFileSync(join(REPO, rel), 'utf8');
      // Read the CALL, not the file. Two earlier shapes of this guard asked whether the
      // whole file TEXT held the right pattern, and ordinary prose defeated both: first the
      // header of projectArg.helpers.mjs, which then spelled out an unnamed call to explain
      // itself, and after a comment-stripping pass was added, a TRAILING comment sharing a
      // line with code, which a whole-line strip does not touch. Stripping comments is a
      // losing game; scoping the question to the argument narrows it to text someone has to
      // write inside the braces on purpose.
      const readable = src.match(/initializeApp\(\s*\{[^{}]*\}/g) ?? [];
      for (const call of readable) {
        if (!call.includes('applicationDefault()')) continue;
        if (!call.includes('projectId')) offenders.push(basename(rel));
      }
      // A call whose argument is not an inline object literal — `initializeApp(config)`, a
      // nested brace, or no argument at all — is unreadable from here, so it is named rather
      // than waved through. A false alarm on an unusual but correct file is the safe
      // direction for this guard; silence over an unnamed project is the direction that
      // cost real data.
      //
      // COUNTS, not existence. An earlier version asked whether the file contained ANY
      // readable call, which let a second unreadable one ride along beside a correct
      // sibling — the exact ADC-with-no-project shape, sitting next to code that looks
      // fine. A shortfall means some call here was not read, and that is enough to name
      // the file.
      const calls = (src.match(/initializeApp\(/g) ?? []).length;
      if (calls > readable.length) offenders.push(basename(rel));
    }
    expect(offenders).toEqual([]);
  });
});
