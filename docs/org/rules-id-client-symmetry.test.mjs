// firestore.rules and the CLIENT's id builder must agree about which doc ids exist (BIN-1002).
//
// Run: npm test (this file is in vitest.config.ts's `include` via
// 'docs/org/**/*.{test,spec}.mjs' — the same glob route.test.mjs, gate-symmetry.test.mjs and
// rules-doc-id-symmetry.test.mjs rely on). Deliberately NOT under src/test/rules/, which
// vitest.config.ts excludes outright: that directory runs only under `npm run test:rules`,
// behind the Firestore emulator and a Java install, and this check needs neither.
//
// THE SIBLING, AND WHY THIS FILE EXISTS BESIDE IT. `rules-doc-id-symmetry.test.mjs` (BIN-998)
// holds the rules file's TWO copies of the id-shape rule byte-identical to each other. That is
// the smaller invariant: if those two drift, one collection ends up stricter than the other and
// both halves still refuse junk. The invariant that decides whether real writes go through is a
// different pair — the rules regex against the id the app actually builds. Drift THERE means the
// app writes ids the rules refuse, or the rules admit shapes the app cannot read back. That is
// the exact shape of BIN-797 (`movie_0` written by the sweep, then refused by the client) and of
// BIN-560/618/766/931/932.
//
// AND WHY IT DOES NOT LEAN ON THAT SIBLING (BIN-1048). Every guard function in GUARD_FUNCTIONS is
// extracted and compared on its own, so this file's coverage does not depend on the two rules
// copies staying byte-identical. The sibling's header invites its own deletion the day they are
// meant to diverge; when that happens, this file keeps checking both against the client rather
// than silently dropping one of the two collections.
//
// HOW IT AVOIDS BEING A THIRD COPY OF THE RULE. Nothing here restates either side:
//   * the rules regex is EXTRACTED from firestore.rules as text;
//   * the client's verdict comes from CALLING the real `mediaTypeDocId` and
//     `parseTmdbIdFromDocId` (a .mjs test can import the TypeScript module — vitest transforms
//     it, and the probe that established this ran before the file was written).
// So the cases are generated and both answers are asked of the real thing. A hand-written
// example proves only that the example works, which is what the ticket said had to change.
//
// WHAT THIS DOES NOT CLAIM:
//   * NOT that either side is CORRECT. It says they AGREE. Whether the agreed set is the right
//     set is src/test/rules/firestore-rules.test.ts's job, against the emulator.
//   * NOT anything about `update`. Both rules blocks apply the id guard on CREATE only, and
//     leave update deliberately unguarded (firestore.rules says so at both sites). Nothing here
//     touches that decision or validates it.
//   * NOT anything about LEGACY bare-`123` documents, which exist in both collections and
//     predate the namespacing. `mediaTypeDocId` never emits one, so no generated case is one.
//   * NOT that the client and the SERVER helper (functions/src/shared/mediaTypeDocId.ts) agree.
//     They deliberately diverge on the read side since BIN-618; `mediaTypeDocId.parity.test.ts`
//     owns that pair.
//
// MEANT TO BE DELETED, NOT WORKED AROUND. Intending to let the two sides diverge? Delete this
// file in the same commit that makes them disagree, and say why. Do not add an allowlist, an
// exception entry or a normalisation step — that turns a loud failure into a permanent silent
// one.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mediaTypeDocId, parseTmdbIdFromDocId } from '../../src/lib/mediaTypeDocId.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = readFileSync(join(REPO_ROOT, 'firestore.rules'), 'utf8');

// Anchored on the FUNCTION NAME, never on a line number — a line number is false in the same
// commit it ships in (BIN-954).
//
// BOTH of firestore.rules' id-guarding functions, each checked on its own (BIN-1048). Adding a
// third guard to the rules means adding its name here; the floors below then apply to it too.
const GUARD_FUNCTIONS = ['canonicalWatchlistDocId', 'canonicalSwipeDocId'];

/** The quoted argument of the single `id.matches(…)` inside the named rules function. */
function rulesIdPattern(name) {
  const decl = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}`);
  const body = RULES.match(decl)?.[1] ?? '';
  return body.match(/id\.matches\(\s*(['"])([\s\S]*?)\1\s*\)/)?.[2] ?? null;
}

/**
 * The numeric parts every generated case is built from — spread deliberately across the
 * boundaries the two sides have actually disagreed about before:
 *   `0`      BIN-646/797, the phantom title-id-0
 *   `042`    BIN-618, the leading-zero alias
 *   `''`     the empty suffix (`movie_`)
 *   `-5`     a negative that `Number()` accepts
 *   `1.5`    a non-integer
 * plus ordinary ids on both sides of one and two digits, and a large one.
 */
const NUMERIC_CASES = [
  '1', '2', '9', '10', '42', '99', '100', '1399', '999999', '2147483647',
  '0', '00', '042', '0042', '', '-1', '-5', '1.5', '1e3', ' 42', '42 ', '4_2', 'xyz', '4a2',
];
const MEDIA_TYPES = ['movie', 'tv'];

/** Every generated `{docId, rulesAccepts, clientAccepts}` triple. */
function cases(pattern) {
  const rulesRegex = new RegExp(pattern);
  return MEDIA_TYPES.flatMap((type) =>
    NUMERIC_CASES.map((numeric) => {
      const docId = mediaTypeDocId(type, numeric);
      return {
        docId,
        rulesAccepts: rulesRegex.test(docId),
        clientAccepts: Number.isFinite(parseTmdbIdFromDocId(docId)),
      };
    }),
  );
}

// THE ROSTER FLOOR, outside the per-guard block on purpose (BIN-1048). `describe.each([])`
// registers no tests and vitest reports a pass, so an emptied — or halved — GUARD_FUNCTIONS
// would silence every assertion below without failing anything. This is the one check that
// cannot live inside the loop.
describe('the guard roster itself', () => {
  it('names every id-guarding function firestore.rules declares', () => {
    const declared = [...RULES.matchAll(/function\s+(canonical\w*DocId)\s*\(/g)].map((m) => m[1]);
    const unique = [...new Set(declared)].sort();

    expect(unique.length, 'firestore.rules declares no canonical*DocId function at all — either '
      + 'the guards were removed (delete this file with them) or renamed past this pattern')
      .toBeGreaterThanOrEqual(2);
    expect(
      [...GUARD_FUNCTIONS].sort(),
      'firestore.rules declares an id-guarding function this file does not check. Add its name '
      + 'to GUARD_FUNCTIONS — a guard nobody compares against the client is exactly the gap '
      + 'BIN-1048 was filed about. If a guard is deliberately out of scope, delete it from the '
      + 'rules or say why here; do not shrink this assertion.',
    ).toEqual(unique);
  });
});

describe.each(GUARD_FUNCTIONS)('firestore.rules %s vs the client id builder (BIN-1002)', (guard) => {
  // THE FLOOR, and it is the load-bearing half of this file — the silent-ratchet shape this
  // repo has hit in BIN-823, BIN-852, BIN-931 and BIN-998. An extraction that stops matching
  // returns null, a corpus that stops generating returns nothing, and comparing nothing to
  // nothing passes. So all three are asserted BEFORE any agreement is checked, and each says
  // something different because each means something different. They run PER guard function:
  // one shared floor over a merged corpus would still pass with one guard's extraction blind.
  it('extracts a pattern from firestore.rules at all', () => {
    expect(
      rulesIdPattern(guard),
      `No id.matches(...) found inside ${guard} in firestore.rules. Either the guard `
      + 'was removed — in which case this whole check is obsolete and should be deleted with '
      + 'it, not silenced — or it was reworded so this extraction no longer sees it, in which '
      + 'case the guard is now blind and must be re-anchored.',
    ).toBeTruthy();
  });

  it('generates enough cases, on BOTH sides of the accept boundary', () => {
    const generated = cases(rulesIdPattern(guard));
    const accepted = generated.filter((c) => c.rulesAccepts).length;
    const rejected = generated.length - accepted;

    // Floors, not equalities: adding a case to NUMERIC_CASES must never fail this.
    expect(generated.length, 'the corpus collapsed — this file is comparing nothing to nothing')
      .toBeGreaterThanOrEqual(40);
    expect(accepted, 'no generated id is ACCEPTED, so agreement is vacuously about refusals')
      .toBeGreaterThanOrEqual(10);
    expect(rejected, 'no generated id is REFUSED, so agreement is vacuously about acceptances')
      .toBeGreaterThanOrEqual(10);
  });

  it('agrees on every generated id — the rules and the app admit the same set', () => {
    const disagreements = cases(rulesIdPattern(guard))
      .filter((c) => c.rulesAccepts !== c.clientAccepts)
      .map((c) => `${c.docId} — rules ${c.rulesAccepts ? 'accepts' : 'refuses'}, `
        + `client ${c.clientAccepts ? 'accepts' : 'refuses'}`);

    expect(
      disagreements,
      `firestore.rules' ${guard} and src/lib/mediaTypeDocId.ts no longer admit the same doc ids. `
      + 'Whichever side moved, move the other in the same commit — an id the rules accept and '
      + 'the app cannot read is an invisible document (BIN-797), and an id the app writes and '
      + 'the rules refuse is a write that silently fails. Do not normalise or allowlist the '
      + 'difference away.',
    ).toEqual([]);
  });
});
