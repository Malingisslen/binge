// The twin document-id guards in firestore.rules must change together (BIN-998).
//
// Run: npm test (this file is in vitest.config.ts's `include` via
// 'docs/org/**/*.{test,spec}.mjs' — the same glob route.test.mjs and
// gate-symmetry.test.mjs rely on). Deliberately NOT under src/test/rules/, which
// vitest.config.ts excludes outright: that directory runs only under `npm run
// test:rules`, behind the Firestore emulator and a Java install, which is a weaker
// and differently-gated place for a check that reads the rules file as plain text.
//
// WHAT THIS BINDS, and nothing wider: the STRING passed to id.matches() inside
// `canonicalWatchlistDocId` and `canonicalSwipeDocId`. Two collections carry the same
// id-shape rule as two deliberate copies — the rules language would allow a hoisted
// helper, but the two collections have different legacy inheritance and may need to
// diverge. firestore.rules says so in prose at both sites. Until BIN-998 nothing
// checked it, so "narrow one and forget the other" was a silent state.
//
// WHAT THIS DOES NOT CLAIM:
//   * NOT that the shared expression is CORRECT. Whether the regex admits the right
//     ids is src/test/rules/firestore-rules.test.ts's job, against the emulator.
//     A green run here is not "the rule is right", only "the two copies agree".
//   * NOT that the two collections are equivalent in data category, lawful basis or
//     retention. They are not: a watchlist is indefinite user-owned data, a swipe is
//     an anonymous session vote under a short TTL. This binds an id-shape string, and
//     an id-shape string is syntax, not personal-data content.
//   * NOT that the rules and the CLIENT's id builder (src/lib/mediaTypeDocId.ts) agree.
//     That is the larger invariant and it belongs to a different file — since BIN-1002 it
//     is held by docs/org/rules-id-client-symmetry.test.mjs, which extracts the same
//     expression and drives it against the ids mediaTypeDocId actually emits.
//
// WRITTEN 2026-08-25 (BIN-998), AND MEANT TO BE DELETED, NOT WORKED AROUND.
// INTENDING TO LET THE TWO DIVERGE? DELETE the byte-identity assertion below, in the
// same commit that gives the two functions different bodies. Do not add an allowlist,
// an exception entry or a normalisation step to make a deliberate divergence pass —
// that turns a loud, readable failure into a permanent silent one. Deleting it is an
// ordinary change under the repo's normal review gates; it is an integrity check, not
// a privacy decision, so it needs no separate sign-off.
//
// Byte-identity is stricter than semantic equivalence ON PURPOSE. Rewriting `[0-9]`
// as `\d` in one copy only would trip this check while "behaving the same" — and that
// is the point, because `\d` and `[0-9]` are not the same set everywhere, and a
// rewrite that touches one copy is exactly the shape being guarded against. If this
// check ever fails on a rewrite you believe is harmless, make the same edit to both
// copies; do not loosen the comparison.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES_PATH = join(REPO_ROOT, 'firestore.rules');
const RULES = readFileSync(RULES_PATH, 'utf8');

// Anchored on the FUNCTION NAMES, never on line numbers: a line number is false in the
// same commit it ships in, and any edit above either site would move both (BIN-954).
const TWINS = ['canonicalWatchlistDocId', 'canonicalSwipeDocId'];

/** Every `function canonical…DocId` declared in firestore.rules, in file order. */
function declaredTwinNames() {
  return [...RULES.matchAll(/function\s+(canonical[A-Za-z0-9]*DocId)\s*\(/g)].map((m) => m[1]);
}

/** The quoted argument of every `id.matches(…)` inside the named function's body. */
function idMatchesArgumentsIn(name) {
  const decl = new RegExp(
    `function\\s+${name}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}`,
    'g',
  );
  const bodies = [...RULES.matchAll(decl)].map((m) => m[1]);
  return bodies.flatMap((body) =>
    [...body.matchAll(/id\.matches\(\s*(['"])([\s\S]*?)\1\s*\)/g)].map((m) => m[2]),
  );
}

describe('firestore.rules twin document-id guards (BIN-998)', () => {
  // THE FLOOR, and it is the load-bearing half of this file. An extraction regex that
  // stops matching returns an empty list, and comparing nothing to nothing passes —
  // the silent-ratchet shape this repo has now hit in BIN-823, BIN-852 and BIN-931.
  // So the count is asserted BEFORE anything is compared, and each wrong count says
  // something different, because the three mean three different things.
  it('declares exactly the two known twins, no more and no fewer', () => {
    const found = declaredTwinNames();

    expect(
      found.length,
      found.length < TWINS.length
        ? `firestore.rules declares ${found.length} canonical…DocId function(s) (${found.join(', ') || 'none'}), expected ${TWINS.length}. ` +
          'Either a twin was DELETED — in which case this whole check is obsolete and should be deleted with it, not silenced — ' +
          'or the declaration was reworded so this extraction no longer sees it, in which case the guard is now blind and must be re-anchored.'
        : `firestore.rules declares ${found.length} canonical…DocId functions (${found.join(', ')}), expected ${TWINS.length}. ` +
          'A THIRD copy of the id-shape rule is a decision nobody has made yet: decide whether it joins this identity check or is deliberately independent, and say which here.',
    ).toBe(TWINS.length);

    expect(found.slice().sort()).toEqual(TWINS.slice().sort());
  });

  it.each(TWINS)('%s contains exactly one id.matches() expression', (name) => {
    const args = idMatchesArgumentsIn(name);
    expect(
      args.length,
      `Expected exactly one id.matches(...) inside ${name}, found ${args.length}. ` +
        'Zero means the extraction is blind and this file is no longer guarding anything; ' +
        'more than one means the function grew a second id rule that this check does not compare.',
    ).toBe(1);
  });

  it('holds the two id-shape expressions byte-identical', () => {
    const [watchlist] = idMatchesArgumentsIn('canonicalWatchlistDocId');
    const [swipe] = idMatchesArgumentsIn('canonicalSwipeDocId');

    expect(
      swipe,
      'The two deliberate copies of the id-shape rule have drifted apart. ' +
        'If ONE was meant to be narrowed, narrow the other in the same commit. ' +
        'If they are meant to diverge for good, delete this assertion in the commit that ' +
        'gives them different bodies — do not normalise, allowlist, or compare them loosely.',
    ).toBe(watchlist);
  });
});
