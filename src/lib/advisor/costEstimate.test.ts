import { describe, it, expect } from 'vitest';
import { isEstimatedMonthlyCost, summarizeMonthlySpend } from './costEstimate';
import { getProvider } from '@/lib/tmdb/providers';

const NOW = new Date(2026, 9, 5); // 5 okt 2026, lokal tid
const NETFLIX = 8;
const VIAPLAY = 76;
const SVT = 520;
const PRIME = 119; // utan nivåer

describe('isEstimatedMonthlyCost', () => {
  it('ingen nivå och ingen egen kostnad är listpriset, alltså uppskattat', () => {
    expect(isEstimatedMonthlyCost(NETFLIX, {}, NOW)).toBe(true);
    expect(isEstimatedMonthlyCost(PRIME, {}, NOW)).toBe(true);
  });

  it('en vald nivå som finns i katalogen är användarens eget belopp', () => {
    expect(isEstimatedMonthlyCost(NETFLIX, { providerTiers: { [NETFLIX]: 'basic' } }, NOW)).toBe(false);
  });

  it('en vald nivå som katalogen tagit bort faller tillbaka på listpriset och är uppskattad', () => {
    expect(isEstimatedMonthlyCost(NETFLIX, { providerTiers: { [NETFLIX]: 'finns-inte' } }, NOW)).toBe(true);
  });

  it('en vald nivå med en kvarliggande egen kostnad: nivån avgör, inte uppskattat', () => {
    const user = { providerTiers: { [NETFLIX]: 'basic' }, providerCosts: { [NETFLIX]: 150 } };
    expect(isEstimatedMonthlyCost(NETFLIX, user, NOW)).toBe(false);
    expect(summarizeMonthlySpend([NETFLIX], user, NOW).totalKr).toBe(129);
  });

  it('en egen kostnad är användarens eget belopp', () => {
    expect(isEstimatedMonthlyCost(PRIME, { providerCosts: { [PRIME]: 59 } }, NOW)).toBe(false);
  });

  it('en vald sportnivå är ett eget val, inte en uppskattning', () => {
    expect(isEstimatedMonthlyCost(VIAPLAY, { providerTiers: { [VIAPLAY]: 'medium' } }, NOW)).toBe(false);
  });

  it('en gratistjänst är aldrig en uppskattning', () => {
    expect(isEstimatedMonthlyCost(SVT, {}, NOW)).toBe(false);
  });

  it('en löpande kampanj är användarens eget belopp, en utgången faller tillbaka', () => {
    const active = { providerCampaigns: { [NETFLIX]: { monthlyCost: 99, endDate: '2026-12-31' } } };
    const lapsed = { providerCampaigns: { [NETFLIX]: { monthlyCost: 99, endDate: '2026-09-30' } } };
    expect(isEstimatedMonthlyCost(NETFLIX, active, NOW)).toBe(false);
    expect(isEstimatedMonthlyCost(NETFLIX, lapsed, NOW)).toBe(true);
  });

  it('okänd tjänst är ingen uppskattning (den har inget belopp)', () => {
    expect(isEstimatedMonthlyCost(999_999, {}, NOW)).toBe(false);
  });
});

describe('summarizeMonthlySpend', () => {
  it('bara gratistjänster ger noll betalda och ingen summa', () => {
    expect(summarizeMonthlySpend([SVT], {}, NOW)).toEqual({ totalKr: 0, paidCount: 0, estimated: false });
  });

  it('gratistjänsten räknas inte bland tjänsterna', () => {
    const s = summarizeMonthlySpend([NETFLIX, SVT], { providerTiers: { [NETFLIX]: 'standard' } }, NOW);
    expect(s).toEqual({ totalKr: 169, paidCount: 1, estimated: false });
  });

  it('"Vet inte" ger katalogens standardpris, aldrig en sportnivå', () => {
    const viaplay = getProvider(VIAPLAY)!;
    const s = summarizeMonthlySpend([VIAPLAY], {}, NOW);
    expect(s.totalKr).toBe(viaplay.defaultMonthlyCost);
    const sportCosts = viaplay.tiers!.filter(t => t.kind === 'sport').map(t => t.cost);
    expect(sportCosts).not.toContain(s.totalKr);
    expect(s.estimated).toBe(true);
  });

  it('en blandning är uppskattad, och att välja nivå på den sista vänder det', () => {
    const mixed = summarizeMonthlySpend([NETFLIX, VIAPLAY], { providerTiers: { [NETFLIX]: 'standard' } }, NOW);
    expect(mixed.estimated).toBe(true);
    const all = summarizeMonthlySpend(
      [NETFLIX, VIAPLAY],
      { providerTiers: { [NETFLIX]: 'standard', [VIAPLAY]: 'reklam' } },
      NOW,
    );
    expect(all).toEqual({ totalKr: 169 + 99, paidCount: 2, estimated: false });
  });

  it('en löpande kampanj sänker summan till kampanjpriset', () => {
    const s = summarizeMonthlySpend(
      [NETFLIX],
      { providerCampaigns: { [NETFLIX]: { monthlyCost: 99, endDate: '2026-12-31' } } },
      NOW,
    );
    expect(s).toEqual({ totalKr: 99, paidCount: 1, estimated: false });
  });
});
