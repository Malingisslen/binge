import { describe, it, expect } from 'vitest';
import { applyRuntimeBudget, runtimeBudgetLabel, RUNTIME_BUDGETS } from './runtimeLens';

const it_ = (tmdbId: number, runtime: number | null | undefined) => ({ tmdbId, runtime });

describe('applyRuntimeBudget (BIN-93 runtime lens, BIN-167 dim-not-hide)', () => {
  it('returns everything, never dimmed, when no budget is set', () => {
    const items = [it_(1, 90), it_(2, null), it_(3, 200)];
    const out = applyRuntimeBudget(items, null);
    expect(out.map(r => r.item.tmdbId)).toEqual([1, 2, 3]);
    expect(out.map(r => r.unknownRuntime)).toEqual([false, false, false]);
  });

  it('keeps known runtimes within budget (boundary inclusive), not dimmed', () => {
    const items = [
      it_(1, 30),   // ≤90 ✓
      it_(2, 90),   // exactly 90 ✓ (inclusive)
      it_(3, 91),   // 91 ✗ — known over budget, dropped
      it_(4, 200),  // ✗ — known over budget, dropped
    ];
    const out = applyRuntimeBudget(items, 90);
    expect(out.map(r => r.item.tmdbId)).toEqual([1, 2]);
    expect(out.every(r => r.unknownRuntime === false)).toBe(true);
  });

  it('BIN-167: KEEPS unknown-runtime titles when a budget is active, flagged for dimming', () => {
    const items = [it_(1, 80), it_(2, null), it_(3, undefined), it_(4, 200)];
    const out = applyRuntimeBudget(items, 90);
    // 80 kept (known, fits), null + undefined kept (unknown, dimmed), 200 dropped (known, over)
    expect(out.map(r => r.item.tmdbId)).toEqual([1, 2, 3]);
    expect(out.map(r => r.unknownRuntime)).toEqual([false, true, true]);
  });

  it('returns an empty array for empty input with an active budget', () => {
    expect(applyRuntimeBudget([], 90)).toEqual([]);
  });

  it('runtimeBudgetLabel formats the chip text', () => {
    expect(runtimeBudgetLabel(90)).toBe('≤ 90 min');
  });

  it('exposes the standard budgets', () => {
    expect(RUNTIME_BUDGETS).toEqual([30, 60, 90, 120]);
  });
});
