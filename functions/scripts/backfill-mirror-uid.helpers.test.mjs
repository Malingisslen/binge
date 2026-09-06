import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECTIONS,
  candidates,
  patchFor,
  projectFrom,
  refusalFor,
  stampText,
} from './backfill-mirror-uid.helpers.mjs';

const HERE = join(fileURLToPath(import.meta.url), '..');
// Two files, two jobs. HELPERS is the pure logic this suite can import and call;
// SCRIPT is the admin-SDK runner, which the root vitest cannot import at all
// (firebase-admin is a functions/ dependency). Claims about what the RUNNER does
// are therefore read off its source text — that is the only reach this suite has
// into it, and it is why those assertions are source scans rather than calls.
const HELPERS = readFileSync(join(HERE, 'backfill-mirror-uid.helpers.mjs'), 'utf8');
const SCRIPT = readFileSync(join(HERE, 'backfill-mirror-uid.mjs'), 'utf8');

// The CODE, with `//` comments stripped. The header explains at length why
// `set(merge:true)` is wrong, so a scan of the raw source would match that
// explanation and fail — a source-scan test that trips on the prose defending
// the very choice it is pinning. Assertions about what the file DOES read this;
// assertions about what it SAYS read SCRIPT.
const CODE = SCRIPT.replace(/^\s*\/\/.*$/gm, '');

const row = (id, data) => ({ id, path: `users/other/friends/${id}`, data });

describe('COLLECTIONS — the scope Malin decided 2026-09-06', () => {
  it('covers the two collections nothing else sweeps', () => {
    expect(COLLECTIONS).toEqual(['friends', 'friendRequestsSent']);
  });

  // `followers` is reclaimed weekly by reclaimOrphanFollows, which reads both
  // endpoints out of the PATH and needs no field. Including it here would add a
  // second, unreconciled cleanup path over the same rows — the thing #5 and #27
  // both asked to be decided rather than left implicit. Anchored on the
  // declaration so a rename on the other side is caught too.
  it('deliberately excludes followers', () => {
    expect(COLLECTIONS).not.toContain('followers');
    expect(HELPERS).toContain("export const COLLECTIONS = ['friends', 'friendRequestsSent'];");
  });
});

describe('candidates — which rows the migration must touch', () => {
  it('takes a row with no uid at all', () => {
    expect(candidates([row('gone', { since: 1 })]).map((d) => d.id)).toEqual(['gone']);
  });

  // A value that disagrees with the document id could predate this change.
  // Normalising is always right: the id IS the uid. A migration that only filled
  // the ABSENT case would trust that stray value and leave a row pointing at
  // someone else.
  it('takes a row whose uid disagrees with its own id', () => {
    expect(candidates([row('gone', { uid: 'someone-else', since: 1 })]).map((d) => d.id)).toEqual([
      'gone',
    ]);
  });

  it('leaves an already-correct row alone', () => {
    expect(candidates([row('gone', { uid: 'gone', since: 1 })])).toEqual([]);
  });

  it('picks only the rows that need it out of a mixed page', () => {
    const page = [
      row('a', { uid: 'a', since: 1 }),
      row('b', { since: 2 }),
      row('c', { uid: 'wrong', since: 3 }),
    ];
    expect(candidates(page).map((d) => d.id)).toEqual(['b', 'c']);
  });
});

describe('patchFor — the write must name exactly one field', () => {
  it('writes the document id as uid', () => {
    expect(patchFor(row('gone', { since: 1 }))).toEqual({ uid: 'gone' });
  });

  // The timestamp is the ONLY other field on these rows. Re-stamping it is the
  // failure this repo has been bitten by before — a stamp rewritten on every
  // pass never matures. `toEqual` on the whole object is what pins that: an
  // added key fails it, where a `toHaveProperty` check would not.
  it('carries no timestamp, for either collection shape', () => {
    expect(patchFor(row('x', { since: 1 }))).toEqual({ uid: 'x' });
    expect(patchFor(row('y', { sentAt: 2 }))).toEqual({ uid: 'y' });
  });
});

describe('refusalFor — why the run must not start', () => {
  it('refuses when neither mode flag is given', () => {
    expect(refusalFor([])).toMatch(/--dry-run or --apply/);
    expect(refusalFor(['--project', 'binge-nu'])).toMatch(/--dry-run or --apply/);
  });

  // The dangerous shape: --apply is set, so the write flag is already true when the
  // project check runs. It must still refuse, before any SDK is initialised.
  it('refuses when no project is named, even with --apply set', () => {
    expect(refusalFor(['--apply'])).toMatch(/--project/);
    expect(refusalFor(['--dry-run'])).toMatch(/--project/);
    expect(refusalFor(['--apply', '--project'])).toMatch(/--project/);
  });

  // Without this branch `apply` is read on its own, so the run WRITES while the
  // command says dry-run.
  it('refuses when both mode flags are given at once', () => {
    expect(refusalFor(['--dry-run', '--apply', '--project', 'binge-nu']))
      .toMatch(/mutually exclusive/);
  });

  it('returns null only when a mode AND a project are both named', () => {
    expect(refusalFor(['--dry-run', '--project', 'binge-nu'])).toBeNull();
    expect(refusalFor(['--apply', '--project', 'binge-nu'])).toBeNull();
  });
});

describe('stampText — the before-value must be readable', () => {
  it('renders a Firestore Timestamp as ISO', () => {
    const stamp = { toDate: () => new Date('2026-01-02T03:04:05Z') };
    expect(stampText(stamp)).toBe('2026-01-02T03:04:05.000Z');
  });

  it('falls back to String for anything without toDate', () => {
    expect(stampText(undefined)).toBe('undefined');
    expect(stampText('2026-01-02')).toBe('2026-01-02');
  });
});

describe('the instrument itself', () => {
  // update() fails safely when a row was deleted between read and write;
  // set(merge:true) would RESURRECT it carrying only uid and no timestamp —
  // a worse end state than the one being fixed. Pinned against the source so
  // the choice cannot be quietly reversed.
  it('uses update(), never set with merge', () => {
    expect(CODE).toContain('.update(patch)');
    expect(CODE).not.toContain('merge');
    expect(CODE).not.toContain('.set(');
  });

  // "The guard exists" and "the guard runs" are different claims. Without the
  // entry-point check the CLI runs at import and eats the test runner's argv,
  // and the symptom is vitest hanging with no output rather than failing.
  it('keeps the CLI behind an entry-point check', () => {
    expect(CODE).toContain('fileURLToPath(import.meta.url) === process.argv[1]');
  });

  // A run whose every write was refused must not read like a healthy no-op.
  // The failure this closes: an unconditional catch, a `touched` that is not
  // incremented on a skip, and a `return 0` on every path — so bad credentials
  // and "nothing needed fixing" end on the same line and the same exit code.
  // run() cannot be imported here (firebase-admin does not resolve), so the
  // wiring is pinned in the source.
  it('counts skipped writes and exits non-zero on any of them', () => {
    expect(CODE).toContain('skipped++;');
    expect(CODE).toContain('return skipped > 0 ? 1 : 0;');
    expect(CODE).toContain('${skipped} skipped');
  });
});

describe('projectFrom — the run must name whose data it opens', () => {
  it('reads the id after --project', () => {
    expect(projectFrom(['--project', 'binge-nu', '--dry-run'])).toBe('binge-nu');
    expect(projectFrom(['--dry-run', '--project', 'binge-nu'])).toBe('binge-nu');
  });

  // Undefined is the REFUSAL signal, so every shape that does not actually name a
  // project has to reach it. `--project --apply` is the dangerous one: a flag read
  // as a value would send the run at a project called "--apply".
  it('returns undefined when no project is actually named', () => {
    expect(projectFrom(['--dry-run'])).toBeUndefined();
    expect(projectFrom(['--project'])).toBeUndefined();
    expect(projectFrom(['--project', '--apply'])).toBeUndefined();
    expect(projectFrom([])).toBeUndefined();
    // Without the i === -1 sentinel this one returns 'binge-nu' from argv[0].
    expect(projectFrom(['binge-nu', '--dry-run'])).toBeUndefined();
  });
});

describe('the instrument itself, continued', () => {
  // main()'s body is source-scanned, so pin it as ONE block including the return —
  // an anchor on the condition alone is satisfied while the body is deleted, and an
  // anchor on `run({ apply, projectId })` is satisfied by run's own declaration.
  it('refuses on refusalFor and forwards the parsed project to the SDK', () => {
    expect(CODE).toMatch(
      /const refusal = refusalFor\(argv\);\s*if \(refusal\)\s*{\s*console\.log\(refusal\);\s*return 1;/
    );
    expect(CODE).toContain(
      "return run({ apply: argv.includes('--apply'), projectId: projectFrom(argv) });"
    );
    expect(CODE).toContain('initializeApp({ credential: applicationDefault(), projectId })');
  });

  // stampText is proven by call above; this pins that the LOG LINE uses it.
  it('runs the before-value through stampText', () => {
    expect(CODE).toContain('${stamp}(before)=${stampText(doc.data[stamp])}');
  });

  // --dry-run is only safe while the write sits behind the flag, and the
  // non-zero exit is only real while the entry point forwards it. Both mutants
  // (drop the `if (apply)` guard; hardcode `process.exitCode = 0`) leave every
  // other assertion in this file green.
  it('keeps the write behind --apply and forwards the exit code', () => {
    expect(CODE).toContain('if (apply) {');
    expect(CODE).toContain('process.exitCode = code;');
  });

  it('deletes nothing', () => {
    // A positive anchor first: an empty or unreadable CODE would satisfy every
    // negative below without proving anything.
    expect(CODE).toContain('.update(patch)');
    for (const forbidden of ['.delete(', 'recursiveDelete', 'bulkWriter']) {
      expect(CODE).not.toContain(forbidden);
    }
  });
});
