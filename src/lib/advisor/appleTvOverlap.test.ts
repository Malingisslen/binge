import { describe, it, expect } from 'vitest';
import { appleTvOverlap, viaplayAppleTvTier } from './appleTvOverlap';
import { resolveEffectiveMonthlyCost } from './effectiveCost';
import { summarizeMonthlySpend } from './costEstimate';

const NOW = new Date('2026-11-05T12:00:00');
const VIAPLAY = 76;
const APPLE = 350;
const withApple = { providerTiers: { [VIAPLAY]: 'medium-appletv' } };

describe('appleTvOverlap', () => {
  it('träffar när Apple TV+ är inlagd och Viaplay-nivån har Apple TV', () => {
    expect(appleTvOverlap([VIAPLAY, APPLE], withApple)).toEqual({ viaplayTierName: 'Medium med Apple TV (inkl. sport)', appleTvKr: 119 });
  });
  it('använder användarens eget Apple TV+-belopp', () => {
    expect(appleTvOverlap([VIAPLAY, APPLE], { ...withApple, providerCosts: { [APPLE]: 99 } })?.appleTvKr).toBe(99);
  });
  it('träffar via aliaset 2243 för Apple TV+', () => {
    expect(appleTvOverlap([VIAPLAY, 2243], withApple)).not.toBeNull();
  });
  it('träffar inte utan Apple TV+ inlagd', () => {
    expect(appleTvOverlap([VIAPLAY], withApple)).toBeNull();
  });
  it('träffar inte när Viaplay tagits bort men nivån ligger kvar', () => {
    expect(appleTvOverlap([APPLE], withApple)).toBeNull();
  });
  it('träffar inte för Viaplay-nivå utan Apple TV', () => {
    expect(appleTvOverlap([VIAPLAY, APPLE], { providerTiers: { [VIAPLAY]: 'medium' } })).toBeNull();
    expect(appleTvOverlap([VIAPLAY, APPLE], {})).toBeNull();
  });
  it('okänd nivå som slutar på -appletv ger ingen träff', () => {
    expect(viaplayAppleTvTier({ providerTiers: { [VIAPLAY]: 'xyz-appletv' } })).toBeNull();
  });
});

describe('Apple TV+ räknas en gång', () => {
  it('kostar 0 kr när det ingår i Viaplay-paketet', () => {
    expect(resolveEffectiveMonthlyCost(APPLE, { ...withApple, myProviders: [VIAPLAY, APPLE] }, NOW)).toBe(0);
  });
  it('kostar katalogpriset när Viaplay tagits bort men nivån ligger kvar', () => {
    expect(resolveEffectiveMonthlyCost(APPLE, { ...withApple, myProviders: [APPLE] }, NOW)).toBe(119);
  });
  it('kostar katalogpriset för en Apple TV+ man inte har', () => {
    expect(resolveEffectiveMonthlyCost(APPLE, { ...withApple, myProviders: [VIAPLAY] }, NOW)).toBe(119);
  });
  it('kostar katalogpriset när listan inte är känd', () => {
    expect(resolveEffectiveMonthlyCost(APPLE, withApple, NOW)).toBe(119);
  });
  it('kostar katalogpriset annars', () => {
    expect(resolveEffectiveMonthlyCost(APPLE, { providerTiers: { [VIAPLAY]: 'medium' } }, NOW)).toBe(119);
  });
  it('summan tar bara Viaplay-paketet', () => {
    const s = summarizeMonthlySpend([VIAPLAY, APPLE], withApple, NOW);
    expect(s.totalKr).toBe(479);
    expect(summarizeMonthlySpend([APPLE], withApple, NOW).totalKr).toBe(119);
    expect(s.lines.map(l => l.label)).toEqual(['Viaplay']);
  });
});
