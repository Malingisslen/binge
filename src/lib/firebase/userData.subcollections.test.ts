import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// userData.ts's only runtime dependency is fsdb() from ./db, which transitively
// eager-inits Firebase Auth (config.ts) and throws without env. Stub it so we can
// import the REAL KNOWN_USER_SUBCOLLECTIONS literal hermetically — the const is a
// plain array evaluated at module load, independent of Firebase.
vi.mock('./db', () => ({ fsdb: vi.fn() }));

import { KNOWN_USER_SUBCOLLECTIONS } from './userData';

/**
 * BIN-347 — GDPR subcollection-enumeration guard (the static teeth).
 *
 * The compile-time coverage gate (`dataExport.coverage.test.ts`) proves every
 * `keyof UserDataSnapshots` is classified into both the Art. 20 export and the
 * Art. 17 delete cascade. But it is structurally blind to a `users/{uid}/<x>`
 * subcollection that never enters the helper at all — that path never becomes a
 * `keyof`, so the gate never sees it. That is the exact BIN-277/joinAttempts
 * whole-collection-miss failure mode.
 *
 * This guard closes it WITHOUT an emulator: it parses the authoritative
 * `firestore.rules` for every direct `users/{uid}/<name>` subcollection and
 * asserts that set is EQUAL (both directions) to `KNOWN_USER_SUBCOLLECTIONS`,
 * which is itself asserted equal to the helper's actual reads. So:
 *
 *   rules path  ⇄  KNOWN_USER_SUBCOLLECTIONS  ⇄  collectUserDataSnapshots reads
 *                                                      ↓ (each becomes a keyof)
 *                                          dataExport.coverage.test.ts forces a
 *                                          deleteCascade:true|false classification
 *
 * Adding `users/{uid}/newthing` to rules but forgetting the helper → the first
 * equality goes red. Wiring a read into the helper but forgetting the allowlist
 * → the second goes red. Neither can drift silently.
 *
 * Scope (honest): this is the STATIC half. It proves a subcollection is
 * enumerated + classified; it does NOT prove the cascade's ref actually reaches
 * batch.delete() at runtime (the "referenced but never erased" gap #1). That
 * needs an emulator-backed erasure test against an extracted, db-injectable
 * cascade — tracked as the BIN-347 Part-2 follow-up plan (parked for sign-off,
 * since it refactors the live account-deletion path).
 */

const RULES = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
const USER_DATA_SRC = readFileSync(
  join(process.cwd(), 'src', 'lib', 'firebase', 'userData.ts'),
  'utf8',
);
const INDEXES = JSON.parse(
  readFileSync(join(process.cwd(), 'firestore.indexes.json'), 'utf8'),
) as {
  fieldOverrides?: { collectionGroup: string; fieldPath: string; indexes: { queryScope: string }[] }[];
};

/**
 * Direct `users/{uid}/<name>` subcollections declared in firestore.rules.
 * Depth-exact: the capture group is the FIRST segment after the user wildcard,
 * immediately followed by its own `/{...}` wildcard. A grandchild
 * (`users/{uid}/groups/{gid}/items/{i}`) still maps to its direct child
 * (`groups`); a sibling top-level match (`/reviews/{id}`) or a relative nested
 * match inside another block never matches this anchor, so it can't inflate
 * the set.
 */
function rulesUserSubcollections(): Set<string> {
  const re = /match\s+\/users\/\{[a-zA-Z]+\}\/([a-zA-Z]+)\/\{/g;
  const found = new Set<string>();
  for (const m of RULES.matchAll(re)) found.add(m[1]);
  return found;
}

/** `collection(db, 'users', uid, '<name>')` reads in collectUserDataSnapshots. */
function helperUserSubcollectionReads(): Set<string> {
  const re = /collection\(db,\s*'users',\s*uid,\s*'([a-zA-Z]+)'\)/g;
  const found = new Set<string>();
  for (const m of USER_DATA_SRC.matchAll(re)) found.add(m[1]);
  return found;
}

/** collectionGroup(db, '<name>') queries with their where()-field in the helper. */
function helperCollectionGroupQueries(): { group: string; field: string }[] {
  // Each query is `collectionGroup(db, 'x'), where('y', '==', …)` or
  // `where(documentId(), …)`. Capture the group + the immediately-following
  // where() field so we can demand a matching index.
  const re = /collectionGroup\(db,\s*'([a-zA-Z]+)'\)[\s\S]{0,80}?where\(\s*(documentId\(\)|'[a-zA-Z]+')/g;
  const out: { group: string; field: string }[] = [];
  for (const m of USER_DATA_SRC.matchAll(re)) {
    out.push({ group: m[1], field: m[2].replace(/'/g, '') });
  }
  return out;
}

const known = new Set<string>(KNOWN_USER_SUBCOLLECTIONS);

describe('GDPR user-subcollection enumeration guard (BIN-347)', () => {
  it('KNOWN_USER_SUBCOLLECTIONS has no duplicates', () => {
    expect(KNOWN_USER_SUBCOLLECTIONS.length).toBe(known.size);
  });

  it('the guard is not inert — allowlist, rules parse, and helper parse are all non-empty', () => {
    // Without this, an accidentally-emptied allowlist + a regex that matched zero
    // would let the bidirectional set-equality tests below pass vacuously ([]==[]).
    expect(
      known.size,
      'KNOWN_USER_SUBCOLLECTIONS is empty — the enumeration guard would be inert',
    ).toBeGreaterThan(0);
    expect(
      rulesUserSubcollections().size,
      'rules parser found zero users/{uid}/* subcollections — regex broke or firestore.rules moved',
    ).toBeGreaterThan(0);
    expect(
      helperUserSubcollectionReads().size,
      'helper-read parser found zero collection(db,\'users\',uid,…) reads — regex broke or userData.ts moved',
    ).toBeGreaterThan(0);
  });

  it('firestore.rules users/{uid}/* paths exactly match KNOWN_USER_SUBCOLLECTIONS', () => {
    const inRules = rulesUserSubcollections();
    const missingFromAllowlist = [...inRules].filter(p => !known.has(p)).sort();
    const missingFromRules = [...known].filter(p => !inRules.has(p)).sort();
    // A rules path absent from the allowlist is the whole-collection-miss: a new
    // user subcollection nobody wired into the helper. An allowlist entry absent
    // from rules means a stale allowlist (or a subcollection only enforceable via
    // Console). Both fail loudly — set-equality, both directions.
    expect(
      missingFromAllowlist,
      `users/{uid}/* subcollection(s) in firestore.rules not in KNOWN_USER_SUBCOLLECTIONS — wire them into collectUserDataSnapshots + export/delete coverage`,
    ).toEqual([]);
    expect(
      missingFromRules,
      `KNOWN_USER_SUBCOLLECTIONS entr(ies) with no matching match /users/{uid}/<name> block in firestore.rules`,
    ).toEqual([]);
  });

  it('KNOWN_USER_SUBCOLLECTIONS exactly matches the helper reads (no drift into a third list)', () => {
    const reads = helperUserSubcollectionReads();
    const allowlistNotRead = [...known].filter(p => !reads.has(p)).sort();
    const readNotInAllowlist = [...reads].filter(p => !known.has(p)).sort();
    expect(
      allowlistNotRead,
      `allowlist entr(ies) the helper never reads via collection(db,'users',uid,…)`,
    ).toEqual([]);
    expect(
      readNotInAllowlist,
      `helper reads a users/{uid}/<name> not in KNOWN_USER_SUBCOLLECTIONS — add it (and its export/delete wiring)`,
    ).toEqual([]);
  });

  it('every collection-group query the helper depends on has a COLLECTION_GROUP index (emulator would not catch a deleted one)', () => {
    // DBA gate: the emulator auto-creates single-field indexes and never throws
    // failed-precondition, so a deleted composite/CG override passes in-emulator
    // but breaks the prod deletion read mid-cascade (a half-erased account).
    // documentId() equality on a collection group is auto-indexed via __name__;
    // any OTHER field needs an explicit COLLECTION_GROUP fieldOverride.
    const cgQueries = helperCollectionGroupQueries();
    expect(cgQueries.length, 'expected to find the helper collection-group queries').toBeGreaterThan(0);
    const overrides = INDEXES.fieldOverrides ?? [];
    for (const { group, field } of cgQueries) {
      if (field === 'documentId()') continue; // auto-indexed __name__
      const hasCgIndex = overrides.some(
        o =>
          o.collectionGroup === group &&
          o.fieldPath === field &&
          o.indexes.some(i => i.queryScope === 'COLLECTION_GROUP'),
      );
      expect(
        hasCgIndex,
        `collectionGroup('${group}').where('${field}') needs a COLLECTION_GROUP fieldOverride in firestore.indexes.json — deleting it would throw failed-precondition mid-deletion in prod`,
      ).toBe(true);
    }
  });
});
