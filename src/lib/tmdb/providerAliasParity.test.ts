import { describe, it, expect } from 'vitest';
import { SWEDISH_PROVIDERS } from './providers';
// The two hand-maintained mirrors of the alias→canonical map. functions/ can't
// import the `@/` source of truth (separate tsconfig), so the table is copied by
// hand — and the copies drift (BIN-420: availableNotify was missing 531→431).
// This test is the drift alarm: it derives the expected map from the ONE source
// (SWEDISH_PROVIDERS.aliases) and asserts each mirror still deep-equals it.
import { ALIAS_TO_CANONICAL as AVAILABLE_NOTIFY_ALIASES } from '../../../functions/src/availableNotify/logic';
import { ALIAS_TO_CANONICAL as INSIGHTS_ALIASES } from '../../../functions/src/insights/rollup.helpers';

// Derive the canonical alias→id map from the single source of truth. Alias-id
// keys ONLY → provider.id; NO self-mapping canonical entries — this is the exact
// shape both mirrors store (they rely on `ALIAS_TO_CANONICAL[id] ?? id` for the
// identity fallback, never storing `520: 520`). Throws on a duplicate alias
// pointing at two providers, so a same-alias collision in the source can't slip
// past the parity check by coincidentally matching a mirror.
function deriveExpectedAliasMap(): Record<number, number> {
  const map: Record<number, number> = {};
  for (const p of SWEDISH_PROVIDERS) {
    for (const alias of p.aliases ?? []) {
      if (alias in map && map[alias] !== p.id) {
        throw new Error(
          `Duplicate alias ${alias} maps to both ${map[alias]} and ${p.id} in SWEDISH_PROVIDERS`,
        );
      }
      map[alias] = p.id;
    }
  }
  return map;
}

describe('provider alias map parity (BIN-420)', () => {
  const expected = deriveExpectedAliasMap();

  // Sanity: the derivation itself picked up the known aliases (guards against a
  // future refactor that silently empties the map and makes both mirrors "match"
  // an empty expectation).
  it('derives a non-trivial map that includes the SkyShowtime merge alias', () => {
    expect(Object.keys(expected).length).toBeGreaterThanOrEqual(12);
    expect(expected[531]).toBe(431); // nedlagda Paramount+ → SkyShowtime
    expect(expected[1899]).toBe(384); // legacy HBO Max → Max
  });

  // Strict, symmetric deep-equality — NOT a subset match. This fails on BOTH
  // drift axes: a mirror MISSING a source alias (the 531→431 bug) AND a mirror
  // carrying a STALE extra alias no longer in SWEDISH_PROVIDERS.
  it('availableNotify mirror matches SWEDISH_PROVIDERS aliases exactly', () => {
    expect({ ...AVAILABLE_NOTIFY_ALIASES }).toEqual(expected);
  });

  it('insights rollup mirror matches SWEDISH_PROVIDERS aliases exactly', () => {
    expect({ ...INSIGHTS_ALIASES }).toEqual(expected);
  });
});
