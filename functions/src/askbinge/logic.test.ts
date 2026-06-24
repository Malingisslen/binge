import { describe, it, expect } from 'vitest';
import { validateRecordInput, buildIncrements, canonicalizeFilters } from './logic';

describe('canonicalizeFilters', () => {
  it('keeps only known filter names, deduped and sorted', () => {
    expect(canonicalizeFilters('rating+decade')).toBe('decade+rating');
    expect(canonicalizeFilters('genre+genre')).toBe('genre');
    expect(canonicalizeFilters('none')).toBe('none');
    expect(canonicalizeFilters('')).toBe('none');
  });

  it('drops injected/unknown tokens so a client cannot create arbitrary map keys', () => {
    expect(canonicalizeFilters('genre+__proto__+evil.path')).toBe('genre');
    expect(canonicalizeFilters('drop table')).toBe('none');
  });
});

describe('validateRecordInput', () => {
  it('accepts a well-formed results event', () => {
    const r = validateRecordInput({ type: 'search', resultBucket: '0', filters: 'decade+rating' });
    expect(r).toEqual({ ok: true, value: { type: 'search', resultBucket: '0', filters: 'decade+rating' } });
  });

  it('accepts low_confidence and chip_removed events', () => {
    expect(validateRecordInput({ type: 'low_confidence' })).toEqual({ ok: true, value: { type: 'low_confidence' } });
    expect(validateRecordInput({ type: 'chip_removed', key: 'genreIds' })).toEqual({
      ok: true,
      value: { type: 'chip_removed', key: 'genreIds' },
    });
  });

  it('rejects unknown event types, bad buckets, and unknown chip keys', () => {
    expect(validateRecordInput({ type: 'nope' }).ok).toBe(false);
    expect(validateRecordInput({ type: 'search', resultBucket: '99', filters: 'none' }).ok).toBe(false);
    expect(validateRecordInput({ type: 'chip_removed', key: 'evil' }).ok).toBe(false);
    expect(validateRecordInput(null).ok).toBe(false);
    expect(validateRecordInput('string').ok).toBe(false);
  });

  it('canonicalizes the filters string on the way in (no raw passthrough)', () => {
    const r = validateRecordInput({ type: 'search', resultBucket: '1-9', filters: 'rating+__proto__' });
    expect(r.ok && r.value.type === 'search' && r.value.filters).toBe('rating');
  });
});

describe('buildIncrements', () => {
  it('counts a zero-result search against searches, the 0 bucket, zeroResults, and the combo', () => {
    const incs = buildIncrements({ type: 'search', resultBucket: '0', filters: 'decade+rating' });
    expect(incs).toContainEqual({ path: ['searches'], delta: 1 });
    expect(incs).toContainEqual({ path: ['resultBuckets', '0'], delta: 1 });
    expect(incs).toContainEqual({ path: ['zeroResults'], delta: 1 });
    expect(incs).toContainEqual({ path: ['filterCombos', 'decade+rating', 'searches'], delta: 1 });
    expect(incs).toContainEqual({ path: ['filterCombos', 'decade+rating', 'zero'], delta: 1 });
  });

  it('does NOT add a zeroResults/zero increment for a non-empty search', () => {
    const incs = buildIncrements({ type: 'search', resultBucket: '30+', filters: 'genre' });
    expect(incs).toContainEqual({ path: ['searches'], delta: 1 });
    expect(incs.find((i) => i.path[0] === 'zeroResults')).toBeUndefined();
    expect(incs).toContainEqual({ path: ['filterCombos', 'genre', 'searches'], delta: 1 });
    expect(incs.find((i) => i.path.includes('zero'))).toBeUndefined();
  });

  it('counts low_confidence and chip_removed', () => {
    expect(buildIncrements({ type: 'low_confidence' })).toEqual([{ path: ['lowConfidence'], delta: 1 }]);
    expect(buildIncrements({ type: 'chip_removed', key: 'decade' })).toEqual([
      { path: ['chipRemovals'], delta: 1 },
      { path: ['removedChips', 'decade'], delta: 1 },
    ]);
  });
});
