import { describe, it, expect } from 'vitest';
import { canonicalSpecialsFor, isCanonicalSpecial } from './canonicalSpecials';

const DW_REVIVAL = 57243;   // the only curated show today
const DW_CLASSIC = 121;     // also has a huge season 0 — deliberately NOT curated
const BREAKING_BAD = 1396;  // ordinary show

describe('canonicalSpecialsFor', () => {
  it('returns null for every uncurated show — the global hide-season-0 rule still applies', () => {
    expect(canonicalSpecialsFor(BREAKING_BAD)).toBeNull();
    expect(canonicalSpecialsFor(DW_CLASSIC)).toBeNull();
    expect(canonicalSpecialsFor(0)).toBeNull();
  });

  it('returns a labelled, air-ordered list for Doctor Who 2005', () => {
    const specials = canonicalSpecialsFor(DW_REVIVAL);
    expect(specials).not.toBeNull();
    expect(specials!.label.trim().length).toBeGreaterThan(0);
    // Ascending order is the contract: TMDB lists season 0 in air order, so the
    // section reads chronologically only if the numbers are sorted.
    const nums = [...specials!.episodeNumbers];
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    expect(new Set(nums).size).toBe(nums.length); // no duplicates
  });

  it('keeps the section small — a curated pick, never all of season 0 (199 entries)', () => {
    // The whole point of the allow-list: if this ever grows past ~30 someone has
    // started dumping season 0 back in, which is what the ticket forbids.
    expect(canonicalSpecialsFor(DW_REVIVAL)!.episodeNumbers.length).toBeLessThanOrEqual(30);
    expect(canonicalSpecialsFor(DW_REVIVAL)!.episodeNumbers.length).toBeGreaterThan(0);
  });

  it('covers the broadcast years that exist ONLY as specials (the bug this fixes)', () => {
    // Verified against TMDB tv/57243/season/0: S0E83 "The Day of the Doctor" (2013),
    // S0E210 "The Power of the Doctor" (2022), S0E14 "The Waters of Mars" (2009).
    expect(isCanonicalSpecial(DW_REVIVAL, 83)).toBe(true);
    expect(isCanonicalSpecial(DW_REVIVAL, 210)).toBe(true);
    expect(isCanonicalSpecial(DW_REVIVAL, 14)).toBe(true);
  });

  it('excludes the non-episode season-0 clutter it sits next to', () => {
    // S0E11 "Doctor Who at the Proms", S0E37 "Best of the Doctor",
    // S0E78 "An Adventure in Space and Time" (a drama-doc, not an episode).
    expect(isCanonicalSpecial(DW_REVIVAL, 11)).toBe(false);
    expect(isCanonicalSpecial(DW_REVIVAL, 37)).toBe(false);
    expect(isCanonicalSpecial(DW_REVIVAL, 78)).toBe(false);
  });

  it('is false for any episode of an uncurated show', () => {
    expect(isCanonicalSpecial(BREAKING_BAD, 83)).toBe(false);
    expect(isCanonicalSpecial(DW_CLASSIC, 83)).toBe(false);
  });
});
