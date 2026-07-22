import { describe, it, expect } from 'vitest';
import { relatedSeriesFor } from './relatedSeries';

// The Doctor Who continuity group — three TMDB entries for one fictional series.
const CLASSIC = 121;
const REVIVAL = 57243;
const RELAUNCH = 239770;

describe('relatedSeriesFor', () => {
  // Exact ordered arrays (no sort) — pins BOTH membership and the chronological-order
  // contract the strip relies on to read left-to-right in air order.
  it('returns the two OTHER entries in chronological order for each group member', () => {
    expect(relatedSeriesFor(CLASSIC).map((e) => e.id)).toEqual([REVIVAL, RELAUNCH]);
    expect(relatedSeriesFor(REVIVAL).map((e) => e.id)).toEqual([CLASSIC, RELAUNCH]);
    expect(relatedSeriesFor(RELAUNCH).map((e) => e.id)).toEqual([CLASSIC, REVIVAL]);
  });

  it('never includes the queried id itself (self-exclusion)', () => {
    for (const id of [CLASSIC, REVIVAL, RELAUNCH]) {
      expect(relatedSeriesFor(id).some((e) => e.id === id)).toBe(false);
    }
  });

  it('carries a non-empty human era label on every entry (all three ids covered)', () => {
    // Loop over all three members so every label — including the relaunch's own
    // '2024–', only ever returned when querying a sibling — is asserted.
    for (const id of [CLASSIC, REVIVAL, RELAUNCH]) {
      for (const e of relatedSeriesFor(id)) {
        expect(e.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('returns an empty array for an unmapped show', () => {
    expect(relatedSeriesFor(1396)).toEqual([]); // Breaking Bad — no continuity group
    expect(relatedSeriesFor(0)).toEqual([]);
  });
});
