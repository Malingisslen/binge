import { describe, it, expect } from 'vitest';
import {
  activePauses, episodeCheckedOff, filmCheckedOff, hasPaidService, monthlyBillCard, previousStockholmMonth, stockholmMidnightMs,
} from './logic';

const september = previousStockholmMonth(new Date('2026-10-01T07:00:00Z')); // 09:00 Stockholm on the 1st

describe('previousStockholmMonth', () => {
  it('is September when the job runs on 1 October, bounded by Stockholm midnights', () => {
    expect(september).toMatchObject({ id: '2026-09', name: 'september', firstDay: '2026-09-01', lastDay: '2026-09-30' });
    expect(new Date(september.startMs).toISOString()).toBe('2026-08-31T22:00:00.000Z'); // CEST
    expect(new Date(september.endMs).toISOString()).toBe('2026-09-30T22:00:00.000Z');
  });
  it('crosses the summer-time change: October ends at a CET midnight', () => {
    const october = previousStockholmMonth(new Date('2026-11-01T08:00:00Z'));
    expect(new Date(october.startMs).toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(new Date(october.endMs).toISOString()).toBe('2026-10-31T23:00:00.000Z');
  });
  it('is December of the year before in January', () => {
    const dec = previousStockholmMonth(new Date('2027-01-01T08:00:00Z'));
    expect(dec).toMatchObject({ id: '2026-12', name: 'december', lastDay: '2026-12-31' });
  });
  it('a UTC instant just before Stockholm midnight on the 1st still belongs to the old month', () => {
    expect(previousStockholmMonth(new Date('2026-09-30T21:59:00Z')).id).toBe('2026-08');
    expect(stockholmMidnightMs(2026, 1, 1)).toBe(Date.UTC(2025, 11, 31, 23));
  });
});

describe('hasPaidService', () => {
  it('a catalog service with a price counts, a free one does not', () => {
    expect(hasPaidService({ myProviders: [8] }, [], september)).toBe(true);
    expect(hasPaidService({ myProviders: [520, 300] }, [], september)).toBe(false);
  });
  it('an alias id counts as its service', () => {
    expect(hasPaidService({ myProviders: [1944] }, [], september)).toBe(true);
  });
  it('the user\'s own price of 0 makes the service free, unless a chosen tier exists', () => {
    expect(hasPaidService({ myProviders: [8], providerCosts: { 8: 0 } }, [], september)).toBe(false);
    expect(hasPaidService({ myProviders: [8], providerCosts: { 8: 0 }, providerTiers: { 8: 'basic' } }, [], september)).toBe(true);
    expect(hasPaidService({ myProviders: [8], providerCosts: { 8: 0 }, providerTiers: { 8: 'gone' } }, [], september)).toBe(false);
    // A tier name every object inherits is not a tier: falls through to the own price.
    expect(hasPaidService({ myProviders: [8], providerCosts: { 8: 0 }, providerTiers: { 8: 'constructor' } }, [], september)).toBe(false);
  });
  it('a pause covering the whole month makes it free; one ending inside it does not', () => {
    expect(hasPaidService({ myProviders: [8] }, [{ providerId: 8, pausedAt: '2026-08-15', resumedAt: null }], september)).toBe(false);
    expect(hasPaidService({ myProviders: [8] }, [{ providerId: 8, pausedAt: '2026-08-15', resumedAt: '2026-10-02' }], september)).toBe(false);
    expect(hasPaidService({ myProviders: [8] }, [{ providerId: 8, pausedAt: '2026-08-15', resumedAt: '2026-09-20' }], september)).toBe(true);
    expect(hasPaidService({ myProviders: [8] }, [{ providerId: 8, pausedAt: '2026-09-02', resumedAt: null }], september)).toBe(true);
  });
  it('reads active pauses off the user document', () => {
    expect(activePauses({ providerPauses: { 8: { pausedAt: '2026-08-01' }, 9: {} } })).toEqual([{ providerId: 8, pausedAt: '2026-08-01', resumedAt: null }]);
  });
  it('unknown or malformed provider lists count as nothing paid', () => {
    expect(hasPaidService({ myProviders: [99999] }, [], september)).toBe(false);
    expect(hasPaidService({ myProviders: 'x' }, [], september)).toBe(false);
  });
});

describe('what counts as checked off', () => {
  const inSep = new Date('2026-09-15T18:00:00Z');
  const inOct = new Date('2026-10-01T00:30:00+02:00');
  it('a seen film with its date in the month', () => {
    expect(filmCheckedOff({ mediaType: 'movie', status: 'sedd', watchedAt: inSep }, september)).toBe(true);
    expect(filmCheckedOff({ mediaType: 'movie', status: 'vill_se', watchedAt: inSep }, september)).toBe(false);
    expect(filmCheckedOff({ mediaType: 'tv', status: 'sedd', watchedAt: inSep }, september)).toBe(false);
    expect(filmCheckedOff({ mediaType: 'movie', status: 'sedd', watchedAt: inOct }, september)).toBe(false);
  });
  it('an episode marked watched in the month, read through a Firestore Timestamp', () => {
    const ts = (d: Date) => ({ toMillis: () => d.getTime() });
    expect(episodeCheckedOff({ seasons: { 1: { 3: { watched: true, watchedAt: ts(inSep) } } } }, september)).toBe(true);
    expect(episodeCheckedOff({ seasons: { 1: { 3: { watched: false, watchedAt: ts(inSep) } } } }, september)).toBe(false);
    expect(episodeCheckedOff({ seasons: { 1: { 3: { watched: true, watchedAt: null } } } }, september)).toBe(false);
    expect(episodeCheckedOff({ seasons: { 1: { 3: { watched: true, watchedAt: ts(inOct) } } } }, september)).toBe(false);
    expect(episodeCheckedOff({}, september)).toBe(false);
  });
});

describe('monthlyBillCard', () => {
  it('says Malin\'s text and keys the card on the month', () => {
    expect(monthlyBillCard(september)).toEqual({
      id: 'monthly-bill-2026-09',
      title: 'Din streaming i september',
      body: 'Du har streamat klart i september. Se vad varje tjänst kostade per avsnitt.',
    });
  });
});
