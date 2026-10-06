import { describe, it, expect } from 'vitest';
import { freshRows, parseFeed, rowAppliesTo, MAX_ROWS, type FeedRow } from './logic';

const sky: FeedRow = {
  key: '431-ads-2026-09-03',
  providerIds: [431, 1773, 531],
  tierId: 'ads',
  date: '2026-09-03',
  title: 'SkyShowtime höjer priset',
  body: 'SkyShowtime Standard med annonser har höjt priset från 59 till 69 kr/mån. Det blir 120 kr mer om året.',
};
const prime: FeedRow = { ...sky, key: '119--2026-09', providerIds: [119], tierId: null, date: '2026-09' };

describe('parseFeed', () => {
  it('tar emot en välformad fil', () => {
    expect(parseFeed({ version: 1, rows: [sky, prime] })).toEqual([sky, prime]);
  });

  it('fäller hela filen på en trasig rad, fel version eller för många rader', () => {
    expect(parseFeed({ version: 1, rows: [sky, { ...sky, providerIds: ['431'] }] })).toBeNull();
    expect(parseFeed({ version: 1, rows: [{ ...sky, body: 'x'.repeat(201) }] })).toBeNull();
    expect(parseFeed({ version: 1, rows: [{ ...sky, key: '../users' }] })).toBeNull();
    expect(parseFeed({ version: 2, rows: [sky] })).toBeNull();
    expect(parseFeed({ version: 1, rows: Array(MAX_ROWS + 1).fill(sky) })).toBeNull();
    expect(parseFeed('<html>')).toBeNull();
  });
});

describe('freshRows', () => {
  it('tar en rad som är högst 14 dagar gammal, inte äldre och inte framtida', () => {
    expect(freshRows([sky], '2026-09-17')).toEqual([sky]);
    expect(freshRows([sky], '2026-09-18')).toEqual([]);
    expect(freshRows([sky], '2026-09-02')).toEqual([]);
  });

  it('räknar en månadsrad från den första', () => {
    expect(freshRows([prime], '2026-09-15')).toEqual([prime]);
    expect(freshRows([prime], '2026-09-16')).toEqual([]);
  });
});

describe('rowAppliesTo', () => {
  it('kräver tjänsten, rätt nivå och ingen paus', () => {
    expect(rowAppliesTo(sky, { myProviders: [431], providerTiers: { 431: 'ads' } })).toBe(true);
    expect(rowAppliesTo(sky, { myProviders: [431], providerTiers: { 431: 'premium' } })).toBe(false);
    expect(rowAppliesTo(sky, { myProviders: [431] })).toBe(false);
    expect(rowAppliesTo(sky, { myProviders: [8], providerTiers: { 431: 'ads' } })).toBe(false);
    expect(rowAppliesTo(sky, {
      myProviders: [431], providerTiers: { 431: 'ads' }, providerPauses: { 431: { pausedAt: '2026-09-01', resumeAt: null } },
    })).toBe(false);
  });

  it('matchar ett alias i myProviders men läser kartorna på det kanoniska id:t', () => {
    expect(rowAppliesTo(sky, { myProviders: [1773], providerTiers: { 431: 'ads' } })).toBe(true);
  });

  it('en rad utan nivå gäller alla som har tjänsten', () => {
    expect(rowAppliesTo(prime, { myProviders: [119] })).toBe(true);
  });
});
