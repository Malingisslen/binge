import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
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

/**
 * BIN-1149 — the SERVER half of the erasure: the Admin-SDK collection-group queries
 * the retention sweep and the group handover run. Same failure as the client half
 * (the emulator never demands an index), and BIN-1147's `groupInvites` query would
 * have shipped without one unnoticed.
 *
 * Scope is two directories:
 *   git grep -n "collectionGroup(" -- functions/src/retentionCleanup functions/src/groupHandover
 *
 * Deliberately outside it:
 *   - the notifiers and sweeps elsewhere in functions/src (availableNotify,
 *     priceDropNotify, shared/followedSeries, streamingOffers, tmdbTosSweep, insights,
 *     reclaimOrphanFollows). Several filter on two fields, whose index is a composite
 *     in `indexes`, not a fieldOverride;
 *   - a collection named by a variable (`collectionGroup(kind)`), which no regex can
 *     read. The pattern below only matches a quoted name.
 *
 * A query with MORE than one `.where()`, or an `.orderBy()` after its filter, is not
 * checked against fieldOverrides at all:
 * a single-field override proves nothing about it. It is collected and must be named
 * in COMPOSITE_QUERIES_OUT_OF_SCOPE, so one cannot enter the scope silently.
 */
const SERVER_ERASURE_DIRS = ['functions/src/retentionCleanup', 'functions/src/groupHandover'];
const COMPOSITE_QUERIES_OUT_OF_SCOPE: Record<string, string> = {};

function serverErasureFiles(): string[] {
  return SERVER_ERASURE_DIRS.flatMap((dir) =>
    readdirSync(join(process.cwd(), dir))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => `${dir}/${f}`),
  );
}

type ServerQueries = { single: { file: string; group: string; field: string }[]; composite: string[] };

/** Classifies the quoted collection-group queries in one source text. */
function classifyServerQueries(file: string, src: string, into: ServerQueries): ServerQueries {
  const re = /collectionGroup\('([a-zA-Z]+)'\)((?:\s*\.where\(\s*'[a-zA-Z]+'[^)]*\))+)/g;
  for (const m of src.matchAll(re)) {
    const fields = [...m[2].matchAll(/\.where\(\s*'([a-zA-Z]+)'/g)].map((w) => w[1]);
    // An orderBy after the filter needs a composite too, even behind a select().
    const orderedAfter = /^\s*(?:\.select\([^)]*\)\s*)?\.orderBy\(/.test(src.slice(m.index + m[0].length));
    if (fields.length > 1 || orderedAfter) into.composite.push(`${file}: ${m[1]}.${fields.join('+')}${orderedAfter ? '+orderBy' : ''}`);
    else into.single.push({ file, group: m[1], field: fields[0] });
  }
  return into;
}

function serverCollectionGroupQueries(files: string[]): ServerQueries {
  const out: ServerQueries = { single: [], composite: [] };
  for (const file of files) classifyServerQueries(file, readFileSync(join(process.cwd(), file), 'utf8'), out);
  return out;
}

function hasCollectionGroupOverride(indexes: typeof INDEXES, group: string, field: string): boolean {
  return (indexes.fieldOverrides ?? []).some(
    (o) => o.collectionGroup === group && o.fieldPath === field && o.indexes.some((i) => i.queryScope === 'COLLECTION_GROUP'),
  );
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
    for (const { group, field } of cgQueries) {
      if (field === 'documentId()') continue; // auto-indexed __name__
      expect(
        hasCollectionGroupOverride(INDEXES, group, field),
        `collectionGroup('${group}').where('${field}') needs a COLLECTION_GROUP fieldOverride in firestore.indexes.json — deleting it would throw failed-precondition mid-deletion in prod`,
      ).toBe(true);
    }
  });

  describe('the server erasure paths (BIN-1149)', () => {
    const files = serverErasureFiles();
    const { single, composite } = serverCollectionGroupQueries(files);

    it('reads both erasure directories and finds their single-field queries', () => {
      expect(files.filter((f) => f.startsWith('functions/src/retentionCleanup/')).length).toBeGreaterThan(0);
      expect(files.filter((f) => f.startsWith('functions/src/groupHandover/')).length).toBeGreaterThan(0);
      // The queries BIN-1147 and BIN-1063 added, by name: a regex that broke would
      // find none of them, and a floor on the count alone would not say which.
      const found = new Set(single.map((q) => `${q.group}.${q.field}`));
      for (const q of ['groupInvites.fromUid', 'likes.uid', 'comments.uid', 'reactions.uid']) {
        expect(found, `the server parser no longer finds collectionGroup('${q.split('.')[0]}')`).toContain(q);
      }
    });

    // No erasure query needs a composite today, so the live list above is empty and
    // cannot show the classifier works. These literal sources can.
    it.each([
      ["db.collectionGroup('a').where('x', '==', u).select().get()", 1, []],
      ["db.collectionGroup('a').where('x', '==', u).where('y', '==', v).get()", 0, ['f: a.x+y']],
      ["db.collectionGroup('a').where('x', '==', u).orderBy('y').get()", 0, ['f: a.x+orderBy']],
      ["db.collectionGroup('a').where('x', '==', u).select().orderBy('y')", 0, ['f: a.x+orderBy']],
      ["db.collectionGroup(kind).where('x', '==', u).get()", 0, []],
    ] as const)('classifies %s', (src, singles, composites) => {
      const got = classifyServerQueries('f', src, { single: [], composite: [] });
      expect(got.single).toHaveLength(singles);
      expect(got.composite).toEqual(composites);
    });

    it('a query needing a composite index is named, never checked against a single-field override', () => {
      expect(composite.sort()).toEqual(Object.keys(COMPOSITE_QUERIES_OUT_OF_SCOPE).sort());
    });

    it('every single-field server erasure query has a COLLECTION_GROUP override', () => {
      const missing = single
        .filter((q) => !hasCollectionGroupOverride(INDEXES, q.group, q.field))
        .map((q) => `${q.file}: collectionGroup('${q.group}').where('${q.field}')`);
      expect(missing, 'add a COLLECTION_GROUP fieldOverride in firestore.indexes.json — the emulator will not tell you').toEqual([]);
    });

    // The red proof, run on every test run rather than once by hand: take the entry
    // away from a copy of the index file and the same check must name the query.
    it.each([['groupInvites', 'fromUid'], ['likes', 'uid']])(
      'removing the %s.%s override is caught',
      (group, field) => {
        const without = {
          ...INDEXES,
          fieldOverrides: (INDEXES.fieldOverrides ?? []).filter((o) => !(o.collectionGroup === group && o.fieldPath === field)),
        };
        expect(hasCollectionGroupOverride(INDEXES, group, field)).toBe(true);
        expect(single.some((q) => q.group === group && q.field === field)).toBe(true);
        expect(hasCollectionGroupOverride(without, group, field)).toBe(false);
      },
    );
  });
});
