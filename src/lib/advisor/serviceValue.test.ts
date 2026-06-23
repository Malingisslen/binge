import { describe, it, expect } from 'vitest';
import { rollupServiceValue, attributeProvider, watchedForValueFromItems } from './serviceValue';
import type { WatchedForValue } from './serviceValue';

const monthStart = Date.parse('2026-06-01T00:00:00');
const monthEnd = Date.parse('2026-07-01T00:00:00');
const inJune = Date.parse('2026-06-15T20:00:00');

// Viaplay 76 = 699, Max 384 = 109 (the ticket's example costs).
const costFor = (id: number) => ({ 76: 699, 384: 109 }[id] ?? 0);

const w = (providerId: number, runtimeMinutes: number | null, watchedAtMs = inJune): WatchedForValue =>
  ({ providerId, runtimeMinutes, watchedAtMs });

describe('attributeProvider', () => {
  it('credits a title to the only owned service that carries it', () => {
    expect(attributeProvider([76, 8], [76])).toBe(76);
  });
  it('multi-owned → deterministic lowest canonical id', () => {
    expect(attributeProvider([384, 76], [76, 384])).toBe(76);
  });
  it('resolves aliases before matching (TV4 Play 1944 → 489)', () => {
    expect(attributeProvider([1944], [489])).toBe(489);
  });
  it('returns null when the user owns none of the services', () => {
    expect(attributeProvider([8, 119], [76])).toBeNull();
  });
});

describe('rollupServiceValue', () => {
  it('computes kr-per-title and kr-per-hour per service', () => {
    const rows = rollupServiceValue({
      watched: [w(76, 50)], // Viaplay: 1 episode, 50 min
      ownedProviderIds: [76],
      costFor, monthStartMs: monthStart, monthEndMs: monthEnd,
    });
    const via = rows.find((r) => r.providerId === 76)!;
    expect(via.titlesWatched).toBe(1);
    expect(via.krPerTitle).toBe(699);
    expect(via.krPerHour).toBe(Math.round(699 / (50 / 60))); // ≈839
  });

  it('Max watched 14h across titles → ≈8 kr/h', () => {
    const watched = Array.from({ length: 14 }, () => w(384, 60)); // 14 × 60 min = 14h
    const rows = rollupServiceValue({
      watched, ownedProviderIds: [384], costFor, monthStartMs: monthStart, monthEndMs: monthEnd,
    });
    const max = rows.find((r) => r.providerId === 384)!;
    expect(max.titlesWatched).toBe(14);
    expect(max.minutesWatched).toBe(14 * 60);
    expect(max.krPerHour).toBe(Math.round(109 / 14)); // ≈8
  });

  it('flags a paid service with zero watched titles as dead-weight', () => {
    const rows = rollupServiceValue({
      watched: [w(384, 60)],
      ownedProviderIds: [76, 384],
      costFor, monthStartMs: monthStart, monthEndMs: monthEnd,
    });
    const via = rows.find((r) => r.providerId === 76)!;
    expect(via.titlesWatched).toBe(0);
    expect(via.isDeadWeight).toBe(true);
    expect(via.krPerTitle).toBeNull();
    expect(via.krPerHour).toBeNull();
  });

  it('excludes titles watched outside the month window', () => {
    const may = Date.parse('2026-05-20T12:00:00');
    const rows = rollupServiceValue({
      watched: [w(76, 60, may)],
      ownedProviderIds: [76], costFor, monthStartMs: monthStart, monthEndMs: monthEnd,
    });
    expect(rows[0].titlesWatched).toBe(0);
  });

  it('counts an unknown-runtime title toward the tally but not the hours', () => {
    const rows = rollupServiceValue({
      watched: [w(76, null)],
      ownedProviderIds: [76], costFor, monthStartMs: monthStart, monthEndMs: monthEnd,
    });
    expect(rows[0].titlesWatched).toBe(1);
    expect(rows[0].minutesWatched).toBe(0);
    expect(rows[0].krPerHour).toBeNull();
    expect(rows[0].krPerTitle).toBe(699);
  });

  it('does not count watches attributed to a non-owned service', () => {
    const rows = rollupServiceValue({
      watched: [w(8, 60)], // Netflix, not owned
      ownedProviderIds: [76], costFor, monthStartMs: monthStart, monthEndMs: monthEnd,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].titlesWatched).toBe(0);
  });
});

describe('watchedForValueFromItems', () => {
  const item = (o: Partial<{ providers: number[]; runtime: number | null; watchedAt: Date | null }>) => ({
    providers: [76], runtime: 100, watchedAt: new Date(inJune), ...o,
  });

  it('includes films watched in the window, attributed to an owned service', () => {
    const out = watchedForValueFromItems([item({})], [76], monthStart, monthEnd);
    expect(out).toEqual([{ providerId: 76, runtimeMinutes: 100, watchedAtMs: inJune }]);
  });

  it('skips items with no watchedAt', () => {
    expect(watchedForValueFromItems([item({ watchedAt: null })], [76], monthStart, monthEnd)).toHaveLength(0);
  });

  it('skips items watched outside the month', () => {
    const may = new Date(Date.parse('2026-05-20T12:00:00'));
    expect(watchedForValueFromItems([item({ watchedAt: may })], [76], monthStart, monthEnd)).toHaveLength(0);
  });

  it('skips items not on an owned service', () => {
    expect(watchedForValueFromItems([item({ providers: [8] })], [76], monthStart, monthEnd)).toHaveLength(0);
  });

  it('passes through null runtime', () => {
    const out = watchedForValueFromItems([item({ runtime: null })], [76], monthStart, monthEnd);
    expect(out[0].runtimeMinutes).toBeNull();
  });
});
