import { describe, it, expect } from 'vitest';
import { buildMonthlyBill, previousMonth, type BillPause, type CheckedOffEpisode } from './monthlyBill';
import type { WatchlistItem } from '@/types';

// Viaplay 76, Max 384 (the catalogue ids serviceValue.test.ts uses).
const COST: Record<number, number> = { 76: 449, 384: 109 };
const costFor = (id: number) => COST[id] ?? 0;

const september = previousMonth(new Date('2026-10-06T12:00:00'));
const inSeptember = new Date('2026-09-15T20:00:00');
const inOctober = new Date('2026-10-02T20:00:00');

function show(tmdbId: number, providers: number[]): WatchlistItem {
  return { tmdbId, mediaType: 'tv', status: 'tittar', providers, subscriptionProviders: providers, watchedAt: null } as unknown as WatchlistItem;
}
function film(tmdbId: number, providers: number[], watchedAt: Date | null, status = 'sedd'): WatchlistItem {
  return { tmdbId, mediaType: 'movie', status, providers, subscriptionProviders: providers, watchedAt } as unknown as WatchlistItem;
}
const eps = (tmdbId: number, n: number, at = inSeptember): CheckedOffEpisode[] =>
  Array.from({ length: n }, () => ({ tmdbId, watchedAt: at }));

function bill(params: Partial<Parameters<typeof buildMonthlyBill>[0]>) {
  return buildMonthlyBill({
    items: [], episodes: [], ownedProviderIds: [76, 384], costFor, pauses: [], month: september,
    ...params,
  });
}

describe('previousMonth', () => {
  it('is the calendar month before now, named in Swedish', () => {
    expect(september.name).toBe('september');
    expect(september.firstDay).toBe('2026-09-01');
    expect(september.lastDay).toBe('2026-09-30');
  });

  it('crosses the year boundary in January', () => {
    const dec = previousMonth(new Date('2027-01-03T12:00:00'));
    expect(dec.name).toBe('december');
    expect(dec.firstDay).toBe('2026-12-01');
    expect(dec.lastDay).toBe('2026-12-31');
  });
});

describe('buildMonthlyBill', () => {
  it('prices one checked-off Viaplay episode at the whole monthly cost', () => {
    const b = bill({ items: [show(1, [76]), show(2, [384])], episodes: [...eps(1, 1), ...eps(2, 27)] })!;
    const via = b.lines.find(l => l.providerId === 76)!;
    const max = b.lines.find(l => l.providerId === 384)!;
    expect(via).toMatchObject({ episodes: 1, films: 0, costKr: 449, krPerItem: 449 });
    expect(max).toMatchObject({ episodes: 27, costKr: 109, krPerItem: 4 });
    expect(b.totalKr).toBe(558);
    expect(b.krPerItem).toBe(Math.round(558 / 28));
  });

  it('counts films marked seen in the month, and only while they are still sedd', () => {
    const b = bill({ items: [film(10, [384], inSeptember), film(11, [384], inSeptember, 'vill_se')] })!;
    expect(b.lines.find(l => l.providerId === 384)).toMatchObject({ films: 1, episodes: 0 });
  });

  it('ignores what was checked off outside the month', () => {
    const b = bill({ items: [show(1, [76]), show(2, [384])], episodes: [...eps(1, 3, inOctober), ...eps(2, 1)] })!;
    expect(b.lines.find(l => l.providerId === 76)).toMatchObject({ episodes: 0, krPerItem: null });
  });

  it('shows nothing when nothing at all was checked off, so no service reads as unused for lack of logging', () => {
    expect(bill({ items: [show(1, [76])], episodes: eps(1, 2, inOctober) })).toBeNull();
  });

  it('shows nothing when the user has no paid service', () => {
    expect(bill({ items: [show(1, [76])], episodes: eps(1, 2), costFor: () => 0 })).toBeNull();
  });

  it('credits an episode to one owned service when the show is on two', () => {
    const b = bill({ items: [show(1, [76, 384])], episodes: eps(1, 4) })!;
    const total = b.lines.reduce((n, l) => n + l.episodes, 0);
    expect(total).toBe(4);
  });

  it('does not credit episodes to a film row: an episode only belongs to a TV row with that id', () => {
    const b = bill({ items: [film(1, [76], null, 'vill_se'), show(2, [384])], episodes: [...eps(1, 5), ...eps(2, 1)] })!;
    expect(b.lines.find(l => l.providerId === 76)!.episodes).toBe(0);
  });

  it('a service paused every day of the month costs 0 kr and is listed last', () => {
    const pauses: BillPause[] = [{ providerId: 76, pausedAt: '2026-08-20', resumedAt: null }];
    const b = bill({ items: [show(2, [384])], episodes: eps(2, 2), pauses })!;
    expect(b.lines.at(-1)).toMatchObject({ providerId: 76, costKr: 0, pausedWholeMonth: true, krPerItem: null });
    expect(b.totalKr).toBe(109);
  });

  it('a pause that ended inside the month still charges the month', () => {
    const pauses: BillPause[] = [{ providerId: 76, pausedAt: '2026-08-20', resumedAt: '2026-09-10' }];
    const b = bill({ items: [show(2, [384])], episodes: eps(2, 2), pauses })!;
    expect(b.lines.find(l => l.providerId === 76)).toMatchObject({ costKr: 449, pausedWholeMonth: false });
  });

  it('a pause resumed on the first day after the month covers the whole month', () => {
    const pauses: BillPause[] = [{ providerId: 76, pausedAt: '2026-09-01', resumedAt: '2026-10-01' }];
    const b = bill({ items: [show(2, [384])], episodes: eps(2, 2), pauses })!;
    expect(b.lines.find(l => l.providerId === 76)!.pausedWholeMonth).toBe(true);
  });

  it('lists the dearest service first, whatever was watched on it', () => {
    const b = bill({
      ownedProviderIds: [8, 76, 384],
      costFor: (id) => ({ 8: 169, ...COST }[id] ?? 0),
      items: [show(1, [76]), show(2, [384])],
      episodes: [...eps(1, 1), ...eps(2, 10)],
    })!;
    expect(b.lines.map(l => l.providerId)).toEqual([76, 8, 384]);
  });
});
