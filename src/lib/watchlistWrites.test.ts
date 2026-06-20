import { describe, it, expect } from 'vitest';
import { buildStatusUpdate } from './watchlistWrites';

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
