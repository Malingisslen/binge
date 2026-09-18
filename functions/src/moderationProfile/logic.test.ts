import { describe, it, expect } from 'vitest';
import {
  validateLookupInput, isAdminDoc, projectModerationProfile, spendLookup,
  MODERATION_UID_MAX, MODERATION_LOOKUP_WINDOW_MS, MODERATION_LOOKUPS_PER_WINDOW,
} from './logic';

describe('validateLookupInput (BIN-1244)', () => {
  it('accepts a plain uid', () => {
    expect(validateLookupInput({ uid: 'abc123' })).toEqual({ ok: true, uid: 'abc123' });
  });

  it('rejects a missing, empty, non-string, over-long or path-shaped uid', () => {
    for (const bad of [undefined, null, 'x', {}, { uid: '' }, { uid: 42 }, { uid: 'a'.repeat(MODERATION_UID_MAX + 1) }, { uid: 'a/b' }]) {
      expect(validateLookupInput(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('accepts a uid exactly at the bound', () => {
    expect(validateLookupInput({ uid: 'a'.repeat(MODERATION_UID_MAX) }).ok).toBe(true);
  });
});

describe('isAdminDoc (BIN-1244)', () => {
  it('only a literal true counts', () => {
    expect(isAdminDoc({ isAdmin: true })).toBe(true);
    for (const v of [false, 'true', 1, null, undefined]) {
      expect(isAdminDoc({ isAdmin: v }), String(v)).toBe(false);
    }
    expect(isAdminDoc(undefined)).toBe(false);
  });
});

describe('projectModerationProfile (BIN-1244)', () => {
  it('returns the display fields and nothing else', () => {
    const out = projectModerationProfile({
      displayName: 'Kim', username: 'kim', photoURL: 'https://x/y.png', bio: 'hej', isPublic: false,
      email: 'kim@example.com', createdAt: 'ts', updatedAt: 'ts', hemkommun: 'Umeå',
    });
    expect(out).toEqual({ displayName: 'Kim', username: 'kim', photoURL: 'https://x/y.png', bio: 'hej', isPublic: false });
  });

  it('falls back on wrong types instead of passing them through', () => {
    expect(projectModerationProfile({ displayName: 5, username: 7, photoURL: {}, bio: null, isPublic: 'yes' }))
      .toEqual({ displayName: '', username: null, photoURL: null, bio: '', isPublic: false });
  });
});

describe('spendLookup (BIN-1244)', () => {
  const W = MODERATION_LOOKUP_WINDOW_MS;
  it('opens a window on the first call', () => {
    expect(spendLookup(null, 1000)).toEqual({ windowStartMs: 1000, count: 1 });
  });
  it('counts up inside the window and refuses at the ceiling', () => {
    expect(spendLookup({ windowStartMs: 0, count: MODERATION_LOOKUPS_PER_WINDOW - 1 }, W - 1))
      .toEqual({ windowStartMs: 0, count: MODERATION_LOOKUPS_PER_WINDOW });
    expect(spendLookup({ windowStartMs: 0, count: MODERATION_LOOKUPS_PER_WINDOW }, W - 1)).toBeNull();
  });
  it('starts a new window once the old one has passed', () => {
    expect(spendLookup({ windowStartMs: 0, count: MODERATION_LOOKUPS_PER_WINDOW }, W))
      .toEqual({ windowStartMs: W, count: 1 });
  });
  it('a stored window in the future does not lock the admin out', () => {
    expect(spendLookup({ windowStartMs: 5 * W, count: MODERATION_LOOKUPS_PER_WINDOW }, W))
      .toEqual({ windowStartMs: W, count: 1 });
  });
});
