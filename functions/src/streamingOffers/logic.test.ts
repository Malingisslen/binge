// functions/src/streamingOffers/logic.test.ts
import { describe, it, expect } from 'vitest';
import { isIntentTitle, dedupeIntent, selectRefreshBatch, computeHealth } from './logic';
import type { IntentItem, ExistingOffer } from './types';

const item = (o: Partial<IntentItem>): IntentItem => ({
  tmdbId: 1, mediaType: 'movie', status: 'vill_se', providers: [8], ...o,
});

describe('isIntentTitle', () => {
  it('includes films in vill_se that are on a provider', () => {
    expect(isIntentTitle(item({ mediaType: 'movie', status: 'vill_se', providers: [8] }))).toBe(true);
  });
  it('includes TV in mina that are on a provider', () => {
    expect(isIntentTitle(item({ mediaType: 'tv', status: 'mina', providers: [337] }))).toBe(true);
  });
  it('excludes titles not currently on any provider', () => {
    expect(isIntentTitle(item({ providers: [] }))).toBe(false);
  });
  it('excludes watched films and dropped titles', () => {
    expect(isIntentTitle(item({ status: 'sedd' }))).toBe(false);
    expect(isIntentTitle(item({ status: 'avbruten' }))).toBe(false);
  });
  it('excludes TV in vill_se (legacy/unmigrated) — only mina counts for TV', () => {
    expect(isIntentTitle(item({ mediaType: 'tv', status: 'vill_se', providers: [8] }))).toBe(false);
  });
});

describe('dedupeIntent', () => {
  it('collapses the same tmdbId tracked by multiple users to one entry', () => {
    const out = dedupeIntent([item({ tmdbId: 5 }), item({ tmdbId: 5 }), item({ tmdbId: 6 })]);
    expect(out.map((x) => x.tmdbId).sort()).toEqual([5, 6]);
  });
  it('normalizes mediaType to movie|tv', () => {
    expect(dedupeIntent([item({ tmdbId: 9, mediaType: 'tv' })])[0].mediaType).toBe('tv');
  });
});

describe('selectRefreshBatch', () => {
  const work = [{ tmdbId: 1, mediaType: 'movie' as const }, { tmdbId: 2, mediaType: 'movie' as const }, { tmdbId: 3, mediaType: 'movie' as const }];
  const now = Date.parse('2026-06-20T00:00:00Z');

  it('prioritizes never-checked titles first', () => {
    const existing: ExistingOffer[] = [{ tmdbId: 1, checkedAt: now - 1000, nextLeaving: null }];
    // 2 and 3 have no existing doc -> they come before 1
    const out = selectRefreshBatch(work, existing, now, 2);
    expect(out).toContain(2);
    expect(out).toContain(3);
    expect(out).not.toContain(1);
  });

  it('then prioritizes titles leaving within 5 days (re-confirm)', () => {
    const existing: ExistingOffer[] = [
      { tmdbId: 1, checkedAt: now, nextLeaving: '2026-06-22' }, // leaves in 2 days
      { tmdbId: 2, checkedAt: now - 10_000, nextLeaving: null },
      { tmdbId: 3, checkedAt: now - 5_000, nextLeaving: null },
    ];
    const out = selectRefreshBatch(work, existing, now, 1);
    expect(out).toEqual([1]); // near-expiry beats merely-stale
  });

  it('then falls back to stalest checkedAt', () => {
    const existing: ExistingOffer[] = [
      { tmdbId: 1, checkedAt: now - 1_000, nextLeaving: null },
      { tmdbId: 2, checkedAt: now - 9_000, nextLeaving: null },
      { tmdbId: 3, checkedAt: now - 5_000, nextLeaving: null },
    ];
    const out = selectRefreshBatch(work, existing, now, 2);
    expect(out).toEqual([2, 3]); // oldest first
  });

  it('never returns more than the budget', () => {
    const out = selectRefreshBatch(work, [], now, 2);
    expect(out).toHaveLength(2);
  });
});

describe('computeHealth', () => {
  it('ok when interval is short', () => {
    const h = computeHealth(700, 95, '2026-06-20T00:00:00Z');
    expect(h.refreshIntervalDays).toBe(8); // ceil(700/95)
    expect(h.status).toBe('ok');
  });
  it('warns past 14 days', () => {
    expect(computeHealth(1400, 95, '2026-06-20T00:00:00Z').status).toBe('warn');
  });
  it('critical past 21 days', () => {
    expect(computeHealth(2100, 95, '2026-06-20T00:00:00Z').status).toBe('critical');
  });
  it('exactly 14 days is still ok (boundary)', () => {
    // ceil(1330/95) = 14
    expect(computeHealth(1330, 95, '2026-06-20T00:00:00Z').status).toBe('ok');
  });
  it('exactly 21 days is still warn not critical (boundary)', () => {
    // ceil(1995/95) = 21
    expect(computeHealth(1995, 95, '2026-06-20T00:00:00Z').status).toBe('warn');
  });
});
