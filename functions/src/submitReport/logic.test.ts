import { describe, it, expect } from 'vitest';
import { validateReportInput, isWithinCooldown, REPORT_NOTE_MAX, REPORT_ID_MAX } from './logic';

const base = {
  targetType: 'review',
  targetId: 'rev1',
  targetOwnerUid: 'owner_uid',
  reason: 'spam',
};

describe('validateReportInput', () => {
  it('accepts a well-formed report and strips unknown fields', () => {
    const r = validateReportInput({ ...base, reporterUid: 'forged', extra: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual(base); // reporterUid + extra dropped — server is authoritative
    }
  });

  it('rejects non-object payloads', () => {
    expect(validateReportInput(null).ok).toBe(false);
    expect(validateReportInput('x').ok).toBe(false);
    expect(validateReportInput(undefined).ok).toBe(false);
  });

  it('rejects an invalid reason', () => {
    expect(validateReportInput({ ...base, reason: 'because' }).ok).toBe(false);
    expect(validateReportInput({ ...base, reason: 123 }).ok).toBe(false);
  });

  it('rejects an invalid targetType', () => {
    expect(validateReportInput({ ...base, targetType: 'episode' }).ok).toBe(false);
  });

  it('rejects missing/empty targetId or targetOwnerUid', () => {
    expect(validateReportInput({ ...base, targetId: '' }).ok).toBe(false);
    expect(validateReportInput({ ...base, targetId: undefined }).ok).toBe(false);
    expect(validateReportInput({ ...base, targetOwnerUid: '' }).ok).toBe(false);
  });

  it('rejects oversized id fields (doc-bloat guard)', () => {
    expect(validateReportInput({ ...base, targetId: 'x'.repeat(REPORT_ID_MAX + 1) }).ok).toBe(false);
    expect(validateReportInput({ ...base, targetOwnerUid: 'x'.repeat(REPORT_ID_MAX + 1) }).ok).toBe(false);
    // exactly at the cap is still accepted
    expect(validateReportInput({ ...base, targetId: 'x'.repeat(REPORT_ID_MAX) }).ok).toBe(true);
  });

  it('keeps a trimmed note and truncates to the max length', () => {
    const r = validateReportInput({ ...base, note: '  hej  ' });
    expect(r.ok && r.value.note).toBe('hej');
    const long = validateReportInput({ ...base, note: 'x'.repeat(REPORT_NOTE_MAX + 50) });
    expect(long.ok && long.value.note?.length).toBe(REPORT_NOTE_MAX);
  });

  it('drops an empty/whitespace note rather than storing it', () => {
    const r = validateReportInput({ ...base, note: '   ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect('note' in r.value).toBe(false);
  });

  it('rejects a non-string note', () => {
    expect(validateReportInput({ ...base, note: 42 }).ok).toBe(false);
  });
});

describe('isWithinCooldown', () => {
  const now = 1_000_000;
  it('true when the previous report is newer than the cooldown', () => {
    expect(isWithinCooldown(now - 1, now, 10_000)).toBe(true);
    expect(isWithinCooldown(now - 9_999, now, 10_000)).toBe(true);
  });
  it('false at exactly the cooldown boundary and beyond', () => {
    expect(isWithinCooldown(now - 10_000, now, 10_000)).toBe(false);
    expect(isWithinCooldown(now - 10_001, now, 10_000)).toBe(false);
  });
  it('false when there is no previous report', () => {
    expect(isWithinCooldown(null, now, 10_000)).toBe(false);
  });
});
