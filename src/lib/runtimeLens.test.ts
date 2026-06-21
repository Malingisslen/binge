import { describe, it, expect } from 'vitest';
import { filterByRuntime, runtimeBudgetLabel, RUNTIME_BUDGETS } from './runtimeLens';

const it_ = (tmdbId: number, runtime: number | null | undefined) => ({ tmdbId, runtime });

describe('filterByRuntime (BIN-93 runtime lens)', () => {
  it('returns everything when no budget is set', () => {
    const items = [it_(1, 90), it_(2, null), it_(3, 200)];
    expect(filterByRuntime(items, null)).toBe(items);
  });

  it('keeps only titles with a KNOWN runtime within budget (boundary inclusive)', () => {
    const items = [
      it_(1, 30),   // ≤90 ✓
      it_(2, 90),   // exactly 90 ✓ (inclusive)
      it_(3, 91),   // 91 ✗
      it_(4, 200),  // ✗
    ];
    expect(filterByRuntime(items, 90).map(i => i.tmdbId)).toEqual([1, 2]);
  });

  it('EXCLUDES unknown-runtime titles when a budget is active', () => {
    const items = [it_(1, 80), it_(2, null), it_(3, undefined)];
    expect(filterByRuntime(items, 90).map(i => i.tmdbId)).toEqual([1]); // unknowns dropped
  });

  it('returns an empty array for empty input with an active budget', () => {
    expect(filterByRuntime([], 90)).toEqual([]);
  });

  it('runtimeBudgetLabel formats the chip text', () => {
    expect(runtimeBudgetLabel(90)).toBe('≤ 90 min');
  });

  it('exposes the standard budgets', () => {
    expect(RUNTIME_BUDGETS).toEqual([30, 60, 90, 120]);
  });
});
