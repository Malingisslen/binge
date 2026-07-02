import { describe, it, expect } from 'vitest';
import { canonicalUniqueProviders } from './providers';

describe('canonicalUniqueProviders (BIN-409 — collapse alias/canonical pairs)', () => {
  it('collapses a legacy alias id and its canonical id to one (531 Paramount+ → 431 SkyShowtime)', () => {
    // The exact double-count case: a user who selected Paramount+ (531, now an
    // alias of SkyShowtime) AND SkyShowtime (431) must not count SkyShowtime twice.
    expect(canonicalUniqueProviders([531, 431])).toEqual([431]);
  });

  it('collapses C More (1759) into TV4 Play (489)', () => {
    expect(canonicalUniqueProviders([1759, 489])).toEqual([489]);
  });

  it('preserves order and non-alias ids', () => {
    expect(canonicalUniqueProviders([8, 531, 76])).toEqual([8, 431, 76]);
  });

  it('leaves an already-canonical unique list unchanged', () => {
    expect(canonicalUniqueProviders([8, 76, 431])).toEqual([8, 76, 431]);
  });

  it('is empty for an empty list', () => {
    expect(canonicalUniqueProviders([])).toEqual([]);
  });
});
