import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasStoredAddedAt, resolveAddedAt, addedAtIsRepairable } from './addedAt';

// The whole point of this module is that a MISSING addedAt must not read as
// "now". These tests are only meaningful if "now" is a value they can recognise,
// so the clock is pinned and every assertion says what it is NOT as well as what
// it is.
const NOW = new Date('2026-08-02T12:00:00Z');
const ADDED = new Date('2024-03-01T09:00:00Z');
const UPDATED = new Date('2025-11-20T18:30:00Z');

// Firestore hands back Timestamp objects, which toDate() duck-types on .toDate().
function ts(d: Date) {
  return { toDate: () => d };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('resolveAddedAt', () => {
  it('uses the stored addedAt when there is one', () => {
    expect(resolveAddedAt({ addedAt: ts(ADDED), updatedAt: ts(UPDATED) })).toEqual(ADDED);
  });

  it('falls back to updatedAt when addedAt is absent — NOT to now', () => {
    const resolved = resolveAddedAt({ updatedAt: ts(UPDATED) });
    expect(resolved).toEqual(UPDATED);
    // The regression this module exists for: toDate() ends in `return new Date()`,
    // so before BIN-640 this read as the current moment on every single load.
    expect(resolved).not.toEqual(NOW);
  });

  it('treats an explicitly null addedAt the same as an absent one', () => {
    expect(resolveAddedAt({ addedAt: null, updatedAt: ts(UPDATED) })).toEqual(UPDATED);
  });

  it('still reports now when the doc has neither date — nothing better exists', () => {
    // Not a desirable answer, but an honest one: there is no date on the document
    // to recover. addedAtIsRepairable below is what stops the repair pass from
    // writing this guess back as if it were fact.
    expect(resolveAddedAt({})).toEqual(NOW);
  });
});

describe('hasStoredAddedAt', () => {
  it('distinguishes a stored date from a resolved fallback', () => {
    // resolveAddedAt returns a Date either way, so this is the only thing that can
    // tell the repair pass which docs actually need writing.
    expect(hasStoredAddedAt({ addedAt: ts(ADDED) })).toBe(true);
    expect(hasStoredAddedAt({ updatedAt: ts(UPDATED) })).toBe(false);
    expect(hasStoredAddedAt({ addedAt: null, updatedAt: ts(UPDATED) })).toBe(false);
  });
});

describe('addedAtIsRepairable', () => {
  it('is true exactly when addedAt is missing AND updatedAt can stand in', () => {
    expect(addedAtIsRepairable({ updatedAt: ts(UPDATED) })).toBe(true);
  });

  it('is false when addedAt is already stored — nothing to repair', () => {
    expect(addedAtIsRepairable({ addedAt: ts(ADDED), updatedAt: ts(UPDATED) })).toBe(false);
  });

  it('is false when BOTH are missing, so the repair never invents a date', () => {
    // Without this the repair pass would write resolveAddedAt's "now" guess into
    // Firestore permanently — turning a read-time fallback into fabricated data
    // that the GDPR export cannot distinguish from a real add date.
    expect(addedAtIsRepairable({})).toBe(false);
    expect(addedAtIsRepairable({ addedAt: null, updatedAt: null })).toBe(false);
  });
});
