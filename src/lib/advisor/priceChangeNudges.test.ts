import { describe, it, expect } from 'vitest';
import { computePriceChangeNudges, priceChangeText, PRICE_CHANGE_SHOW_DAYS } from './priceChangeNudges';
import type { PriceChange } from '@/lib/tmdb/providers';

const NOW = new Date(2026, 9, 6); // 2026-10-06

const skyAds: PriceChange = {
  date: '2026-09-03', dateKind: 'noticed', providerId: 431, tierId: 'ads', fromKr: 59, toKr: 69, source: 'https://www.skyshowtime.com/se (BIN-1071)',
};
const primeSep: PriceChange = {
  date: '2026-09-14', dateKind: 'effective', providerId: 119, tierId: null, fromKr: 69, toKr: 89, source: 'https://example.test/prime',
};
const netflixMay: PriceChange = {
  date: '2026-05', dateKind: 'effective', providerId: 8, tierId: 'standard', fromKr: 149, toKr: 169, source: 'https://help.netflix.com/en/node/24926',
};

describe('computePriceChangeNudges', () => {
  it('matchar en tjänst och nivå användaren har', () => {
    const rows = computePriceChangeNudges({ myProviders: [431], providerTiers: { 431: 'ads' } }, NOW, [skyAds]);
    expect(rows).toHaveLength(1);
    expect(rows[0].providerName).toBe('SkyShowtime');
    expect(rows[0].yearlyDiffKr).toBe(120);
  });

  it('tiger när användaren har en annan nivå', () => {
    expect(computePriceChangeNudges({ myProviders: [431], providerTiers: { 431: 'premium' } }, NOW, [skyAds])).toEqual([]);
  });

  it('tiger när användaren inte valt nivå på en tjänst med nivåer — "du har den" vore en gissning', () => {
    expect(computePriceChangeNudges({ myProviders: [431] }, NOW, [skyAds])).toEqual([]);
  });

  it('tiger när användaren inte har tjänsten', () => {
    expect(computePriceChangeNudges({ myProviders: [8], providerTiers: { 431: 'ads' } }, NOW, [skyAds])).toEqual([]);
  });

  it('tiger för en pausad tjänst', () => {
    const rows = computePriceChangeNudges(
      { myProviders: [431], providerTiers: { 431: 'ads' }, providerPauses: { 431: { pausedAt: '2026-09-01', resumeAt: null } } },
      NOW,
      [skyAds],
    );
    expect(rows).toEqual([]);
  });

  it('matchar en tjänst utan nivåer mot en rad med tierId null', () => {
    const rows = computePriceChangeNudges({ myProviders: [119] }, NOW, [primeSep]);
    expect(rows).toHaveLength(1);
    expect(rows[0].tierName).toBeNull();
  });

  it('släpper raden när den är äldre än fönstret', () => {
    expect(computePriceChangeNudges({ myProviders: [8], providerTiers: { 8: 'standard' } }, NOW, [netflixMay])).toEqual([]);
    const lastDay = new Date(2026, 4, 1 + PRICE_CHANGE_SHOW_DAYS);
    expect(computePriceChangeNudges({ myProviders: [8], providerTiers: { 8: 'standard' } }, lastDay, [netflixMay])).toHaveLength(1);
    const dayAfter = new Date(2026, 4, 2 + PRICE_CHANGE_SHOW_DAYS);
    expect(computePriceChangeNudges({ myProviders: [8], providerTiers: { 8: 'standard' } }, dayAfter, [netflixMay])).toEqual([]);
  });
});

describe('priceChangeText', () => {
  it('ett upptäckt datum läses aldrig som "från och med"', () => {
    const [row] = computePriceChangeNudges({ myProviders: [431], providerTiers: { 431: 'ads' } }, NOW, [skyAds]);
    const text = priceChangeText(row);
    expect(text.lead).toBe('SkyShowtime Standard med annonser har höjt priset från 59 till 69 kr/mån. Det blir 120 kr mer om året.');
    expect(text.lead).not.toMatch(/ den | i (jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)|från och med/);
    expect(text.note).toBe('Binge såg det nya priset 3 sep 2026. Ändringen kan ha skett tidigare.');
  });

  it('ett datum från tjänsten själv', () => {
    const [row] = computePriceChangeNudges({ myProviders: [119] }, NOW, [primeSep]);
    expect(priceChangeText(row).lead).toBe(
      'Priset för Amazon Prime Video höjdes från 69 till 89 kr/mån den 14 sep 2026. Det blir 240 kr mer om året.',
    );
  });

  it('en sänkning säger mindre, inte mer', () => {
    const cut: PriceChange = { ...primeSep, fromKr: 89, toKr: 69 };
    const [row] = computePriceChangeNudges({ myProviders: [119] }, NOW, [cut]);
    expect(priceChangeText(row).lead).toBe(
      'Priset för Amazon Prime Video sänktes från 89 till 69 kr/mån den 14 sep 2026. Det blir 240 kr mindre om året.',
    );
  });
});
