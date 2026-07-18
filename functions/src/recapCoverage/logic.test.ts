import { describe, it, expect } from 'vitest';
import { validateMissInput } from './logic';

describe('validateMissInput (BIN-544)', () => {
  it('accepts a valid positive integer tmdbId', () => {
    expect(validateMissInput({ tmdbId: 603 })).toEqual({ ok: true, value: { tmdbId: 603 } });
  });

  it('coerces a numeric string tmdbId', () => {
    expect(validateMissInput({ tmdbId: '603' })).toEqual({ ok: true, value: { tmdbId: 603 } });
  });

  it('rejects a missing tmdbId', () => {
    expect(validateMissInput({}).ok).toBe(false);
  });

  it('rejects zero and negative tmdbId', () => {
    expect(validateMissInput({ tmdbId: 0 }).ok).toBe(false);
    expect(validateMissInput({ tmdbId: -5 }).ok).toBe(false);
  });

  it('rejects a non-integer tmdbId', () => {
    expect(validateMissInput({ tmdbId: 1.5 }).ok).toBe(false);
  });

  it('rejects a non-numeric tmdbId (can\'t be coerced into a safe doc id)', () => {
    expect(validateMissInput({ tmdbId: 'not-a-number' }).ok).toBe(false);
  });

  // Test review (2026-07-18): Number(true) === 1 would otherwise silently pass —
  // restrict coercion to number/string before calling Number() at all.
  it('rejects boolean tmdbId — Number(true) === 1 must not silently pass', () => {
    expect(validateMissInput({ tmdbId: true }).ok).toBe(false);
    expect(validateMissInput({ tmdbId: false }).ok).toBe(false);
  });

  // Test review (2026-07-18): past MAX_SAFE_INTEGER, isInteger stays true but
  // distinct raw inputs can round to the same float — isSafeInteger closes this.
  it('rejects a tmdbId beyond Number.MAX_SAFE_INTEGER', () => {
    expect(validateMissInput({ tmdbId: Number.MAX_SAFE_INTEGER + 2 }).ok).toBe(false);
  });

  it('accepts exactly Number.MAX_SAFE_INTEGER (boundary)', () => {
    expect(validateMissInput({ tmdbId: Number.MAX_SAFE_INTEGER }).ok).toBe(true);
  });

  // Test review (2026-07-18): null is genuinely load-bearing (primitive
  // property access on it throws without the `typeof raw !== 'object'` guard).
  // The string/number cases are NOT independently discriminating — a JS
  // primitive's .tmdbId is always `undefined`, which already gets rejected by
  // the NaN path below regardless of this guard; kept for documentation value
  // (payload shape, not just value, is checked) rather than as a proof each is
  // load-bearing on its own.
  it('rejects a non-object payload', () => {
    expect(validateMissInput(null).ok).toBe(false);
    expect(validateMissInput('603').ok).toBe(false);
    expect(validateMissInput(603).ok).toBe(false);
  });

  it('ignores extra unknown fields — no arbitrary field-shape injection', () => {
    const result = validateMissInput({ tmdbId: 603, season: 1, episode: 2, evilField: '<script>' });
    expect(result).toEqual({ ok: true, value: { tmdbId: 603 } });
  });
});
