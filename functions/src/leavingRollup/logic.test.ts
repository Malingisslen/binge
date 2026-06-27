import { describe, it, expect } from 'vitest';
import { addDaysIso, buildLeavingRollup, type RollupDoc } from './logic';

const TODAY = '2026-07-01';

function doc(tmdbId: number, offers: RollupDoc['offers'], mediaType: 'movie' | 'tv' = 'movie'): RollupDoc {
  return { tmdbId, mediaType, offers };
}
const sub = (providerId: number, leaving: string | null) => ({ providerId, type: 'subscription', leaving });

describe('addDaysIso', () => {
  it('shifts a date by N days (UTC)', () => {
    expect(addDaysIso('2026-07-01', 45)).toBe('2026-08-15');
    expect(addDaysIso('2026-07-01', 0)).toBe('2026-07-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('buildLeavingRollup', () => {
  it('groups a leaving subscription title under its provider', () => {
    const r = buildLeavingRollup([doc(1, [sub(8, '2026-07-10')])], TODAY);
    expect(r.byProvider).toEqual({ '8': [{ tmdbId: 1, mediaType: 'movie', leaving: '2026-07-10' }] });
  });

  it('includes the window boundaries (today and today+withinDays) but excludes outside', () => {
    const r = buildLeavingRollup([
      doc(1, [sub(8, '2026-07-01')]),  // today — included
      doc(2, [sub(8, '2026-08-15')]),  // +45 — included
      doc(3, [sub(8, '2026-06-30')]),  // yesterday — excluded
      doc(4, [sub(8, '2026-08-16')]),  // +46 — excluded
    ], TODAY, 45);
    expect(r.byProvider['8'].map((e) => e.tmdbId)).toEqual([1, 2]);
  });

  it('excludes a title that already left yesterday (isolated lower bound)', () => {
    const r = buildLeavingRollup([doc(1, [sub(8, '2026-06-30')])], TODAY);
    expect(r.byProvider).toEqual({});
  });

  it('ignores rent/buy offers — only subscription leaving counts', () => {
    const r = buildLeavingRollup([doc(1, [{ providerId: 8, type: 'rent', leaving: '2026-07-10' }])], TODAY);
    expect(r.byProvider).toEqual({});
  });

  it('ignores offers with no leaving date', () => {
    const r = buildLeavingRollup([doc(1, [sub(8, null)])], TODAY);
    expect(r.byProvider).toEqual({});
  });

  it('canonicalises aliased provider ids (Max 1899 -> 384)', () => {
    const r = buildLeavingRollup([doc(1, [sub(1899, '2026-07-10')])], TODAY);
    expect(Object.keys(r.byProvider)).toEqual(['384']);
  });

  it('keeps the soonest leaving date when a title lists the provider twice', () => {
    const r = buildLeavingRollup([doc(1, [sub(8, '2026-07-20'), sub(8, '2026-07-05')])], TODAY);
    expect(r.byProvider['8']).toEqual([{ tmdbId: 1, mediaType: 'movie', leaving: '2026-07-05' }]);
  });

  it('sorts each provider nearest-deadline-first', () => {
    const r = buildLeavingRollup([
      doc(1, [sub(8, '2026-07-20')]),
      doc(2, [sub(8, '2026-07-05')]),
      doc(3, [sub(8, '2026-07-12')]),
    ], TODAY);
    expect(r.byProvider['8'].map((e) => e.tmdbId)).toEqual([2, 3, 1]);
  });

  it('a title leaving two services appears under both', () => {
    const r = buildLeavingRollup([doc(1, [sub(8, '2026-07-10'), sub(337, '2026-07-12')])], TODAY);
    expect(r.byProvider['8']).toHaveLength(1);
    expect(r.byProvider['337']).toHaveLength(1);
  });

  it('caps each provider list', () => {
    const docs = Array.from({ length: 100 }, (_, i) => doc(i + 1, [sub(8, addDaysIso(TODAY, (i % 40) + 1))]));
    const r = buildLeavingRollup(docs, TODAY, 45, 80);
    expect(r.byProvider['8'].length).toBe(80);
  });
});
