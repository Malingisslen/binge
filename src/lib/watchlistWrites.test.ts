import { describe, it, expect } from 'vitest';
import { buildStatusUpdate, normalizeTags, MAX_TAGS_PER_ITEM, MAX_TAG_LENGTH } from './watchlistWrites';

// A stand-in for the serverTimestamp() sentinel — the helper just passes it
// through, so any recognisable value works.
const TS = '__server_ts__';
const base = { now: TS, visFields: {} };

describe('buildStatusUpdate', () => {
  it('always sets status and updatedAt', () => {
    const p = buildStatusUpdate('vill_se', base);
    expect(p.status).toBe('vill_se');
    expect(p.updatedAt).toBe(TS);
  });

  // BIN-35 — the core of the fix: clearing the legacy dropped flag.
  it('writes dropped:false for every non-avbruten status (clears legacy flag)', () => {
    for (const s of ['vill_se', 'mina', 'sedd'] as const) {
      expect(buildStatusUpdate(s, base).dropped).toBe(false);
    }
  });

  it('does NOT write dropped when status is avbruten', () => {
    expect('dropped' in buildStatusUpdate('avbruten', base)).toBe(false);
  });

  it('sets watchedAt only for sedd', () => {
    expect(buildStatusUpdate('sedd', base).watchedAt).toBe(TS);
    expect('watchedAt' in buildStatusUpdate('mina', base)).toBe(false);
    expect('watchedAt' in buildStatusUpdate('vill_se', base)).toBe(false);
  });

  // BIN-91 — backdating.
  it('uses watchedAtOverride for sedd when provided (updatedAt stays now)', () => {
    const OVERRIDE = '__backdated__';
    const p = buildStatusUpdate('sedd', { ...base, watchedAtOverride: OVERRIDE });
    expect(p.watchedAt).toBe(OVERRIDE);
    expect(p.updatedAt).toBe(TS); // write-time is always now, not the override
  });

  it('falls back to now when watchedAtOverride is absent or explicitly undefined', () => {
    expect(buildStatusUpdate('sedd', base).watchedAt).toBe(TS);
    // The context passes `undefined` literally (watchedAt ? … : undefined) — pin that.
    expect(buildStatusUpdate('sedd', { ...base, watchedAtOverride: undefined }).watchedAt).toBe(TS);
  });

  it('ignores watchedAtOverride for non-sedd statuses (no watchedAt key)', () => {
    expect('watchedAt' in buildStatusUpdate('mina', { ...base, watchedAtOverride: '__x__' })).toBe(false);
  });

  it('increments rewatchCount only when re-marking sedd over sedd', () => {
    expect(buildStatusUpdate('sedd', { ...base, currentStatus: 'sedd', currentRewatchCount: 2 }).rewatchCount).toBe(3);
    // First time to sedd (from another status) → no rewatch increment.
    expect('rewatchCount' in buildStatusUpdate('sedd', { ...base, currentStatus: 'vill_se' })).toBe(false);
    // Non-sedd status never increments.
    expect('rewatchCount' in buildStatusUpdate('mina', { ...base, currentStatus: 'sedd' })).toBe(false);
  });

  it('defaults rewatchCount from 0 when current count is undefined', () => {
    expect(buildStatusUpdate('sedd', { ...base, currentStatus: 'sedd' }).rewatchCount).toBe(1);
  });

  it('merges visibility fields when provided', () => {
    const p = buildStatusUpdate('mina', { ...base, visFields: { isPublic: true, effectiveVisibility: 'public' } });
    expect(p.isPublic).toBe(true);
    expect(p.effectiveVisibility).toBe('public');
  });
});

// BIN-164 — tag normalization (owner-only watchlistTags store).
describe('normalizeTags', () => {
  it('trims, collapses internal whitespace, and drops empties', () => {
    expect(normalizeTags(['  mysrys  ', 'med   mamma', '   ', ''])).toEqual(['mysrys', 'med mamma']);
  });

  it('dedups case-insensitively (sv-SE) keeping first-seen display casing', () => {
    expect(normalizeTags(['Mysrys', 'mysrys', 'MYSRYS'])).toEqual(['Mysrys']);
    // sv-SE folding: Å/å collapse to one tag.
    expect(normalizeTags(['Åter', 'åter'])).toEqual(['Åter']);
  });

  it('truncates each tag to MAX_TAG_LENGTH chars (and re-trims the cut edge)', () => {
    const long = 'a'.repeat(MAX_TAG_LENGTH + 10);
    expect(normalizeTags([long])).toEqual(['a'.repeat(MAX_TAG_LENGTH)]);
    // A truncation that lands on a space must not leave a trailing space.
    const cut = 'a'.repeat(MAX_TAG_LENGTH - 1) + ' extra';
    expect(normalizeTags([cut])).toEqual(['a'.repeat(MAX_TAG_LENGTH - 1)]);
  });

  it('rejects tags whose folded form collides with a reserved label', () => {
    const reserved = new Set(['drama', 'komedi']);
    expect(normalizeTags(['Drama', 'mysig', 'KOMEDI'], reserved)).toEqual(['mysig']);
  });

  it('caps the list at MAX_TAGS_PER_ITEM', () => {
    const many = Array.from({ length: MAX_TAGS_PER_ITEM + 5 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS_PER_ITEM);
    expect(normalizeTags(many)[0]).toBe('t0');
  });

  it('returns [] for all-empty input', () => {
    expect(normalizeTags(['', '   ', '\t'])).toEqual([]);
  });
});
