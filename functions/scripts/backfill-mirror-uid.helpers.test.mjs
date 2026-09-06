import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTIONS, candidates, patchFor } from './backfill-mirror-uid.helpers.mjs';

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

  // The runner cannot be IMPORTED here — firebase-admin is a functions/
  // dependency and the root runner has no such module — so this is a source scan,
  // and it is weaker than a call: it proves the branch is written, not that it
  // fires. Say so rather than let the green read as more than it is. What it does
  // pin is that the script never defaults to writing when handed no flag.
  it('refuses to run without an explicit flag', () => {
    expect(CODE).toContain("if (!apply && !argv.includes('--dry-run'))");
    expect(CODE).toContain('return 1;');
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
