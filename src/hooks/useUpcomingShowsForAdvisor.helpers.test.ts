import { describe, it, expect } from 'vitest';
import {
  attributeShowsToProviders,
  weekIndexFromAnchor,
  type AttributionProvider,
} from './useUpcomingShowsForAdvisor.helpers';

function provider(partial: Partial<AttributionProvider> & { providerId: number }): AttributionProvider {
  return {
    shortName: `P${partial.providerId}`,
    color: '#000',
    shows: [],
    ...partial,
  };
}

describe('attributeShowsToProviders (BIN-15)', () => {
  it('attributes a multi-provider show to the provider carrying the most other shows', () => {
    // Show 100 finns på BÅDE provider 8 (som bär 3 serier totalt) och
    // provider 9 (som bär bara 1). Den ska landa på 8 — där användaren har mest.
    const providers = [
      provider({ providerId: 9, shows: [{ tmdbId: 100 }] }),
      provider({ providerId: 8, shows: [{ tmdbId: 100 }, { tmdbId: 101 }, { tmdbId: 102 }] }),
    ];
    const map = attributeShowsToProviders(providers, new Set());
    expect(map.get(100)?.providerId).toBe(8);
  });

  it('keeps a single-provider show on its only provider', () => {
    const providers = [
      provider({ providerId: 8, shows: [{ tmdbId: 100 }, { tmdbId: 101 }] }),
      provider({ providerId: 9, shows: [{ tmdbId: 200 }] }),
    ];
    const map = attributeShowsToProviders(providers, new Set());
    expect(map.get(200)?.providerId).toBe(9);
    expect(map.get(100)?.providerId).toBe(8);
  });

  it('breaks ties toward the first-seen provider (deterministic)', () => {
    // Båda tjänsterna bär exakt 1 serie (lika tyngd) — first-seen vinner.
    const providers = [
      provider({ providerId: 9, shows: [{ tmdbId: 100 }] }),
      provider({ providerId: 8, shows: [{ tmdbId: 100 }] }),
    ];
    const map = attributeShowsToProviders(providers, new Set());
    expect(map.get(100)?.providerId).toBe(9);
  });

  it('excludes paused providers entirely', () => {
    // Show 100 finns på pausad 8 (tyngd 3) och aktiv 9 (tyngd 1).
    // Trots att 8 är tyngre ska den pausade aldrig väljas.
    const providers = [
      provider({ providerId: 8, shows: [{ tmdbId: 100 }, { tmdbId: 101 }, { tmdbId: 102 }] }),
      provider({ providerId: 9, shows: [{ tmdbId: 100 }] }),
    ];
    const map = attributeShowsToProviders(providers, new Set([8]));
    expect(map.get(100)?.providerId).toBe(9);
    // Serier som BARA fanns på den pausade tjänsten försvinner ur kartan.
    expect(map.has(101)).toBe(false);
    expect(map.has(102)).toBe(false);
  });

  it('carries shortName and color from the winning provider', () => {
    const providers = [
      provider({ providerId: 9, shortName: 'Viaplay', color: '#abc', shows: [{ tmdbId: 100 }] }),
      provider({ providerId: 8, shortName: 'Netflix', color: '#e50914', shows: [{ tmdbId: 100 }, { tmdbId: 101 }] }),
    ];
    const map = attributeShowsToProviders(providers, new Set());
    expect(map.get(100)).toEqual({ providerId: 8, providerShortName: 'Netflix', providerColor: '#e50914' });
  });

  it('returns an empty map when there are no providers', () => {
    expect(attributeShowsToProviders([], new Set()).size).toBe(0);
  });
});

describe('weekIndexFromAnchor (BIN-105 DST-säkert)', () => {
  it('ger index 0 för ankaret självt och dag 6, index 1 för dag 7', () => {
    // Ankare 2026-03-23 (måndag). Vanlig vecka utan DST-övergång.
    expect(weekIndexFromAnchor('2026-03-09', '2026-03-09')).toBe(0);
    expect(weekIndexFromAnchor('2026-03-09', '2026-03-15')).toBe(0); // dag 6
    expect(weekIndexFromAnchor('2026-03-09', '2026-03-16')).toBe(1); // dag 7
  });

  it('ger index 1 för ett datum exakt 7 kalenderdagar efter ankaret över VÅRENS DST-byte', () => {
    // Sveriges spring-forward 2026 = sista söndagen i mars = 2026-03-29.
    // Ankare måndag 2026-03-23, air date 2026-03-30 = 7 kalenderdagar senare,
    // men spannet innehåller den 23-timmars-dagen. Fast-ms-räkning gav index 0
    // (regressionen); kalenderdags-räkning ger korrekt index 1.
    expect(weekIndexFromAnchor('2026-03-23', '2026-03-30')).toBe(1);
    // Dag 6 (lördag 2026-03-28, före övergången) ligger fortfarande i vecka 0.
    expect(weekIndexFromAnchor('2026-03-23', '2026-03-28')).toBe(0);
    // Två veckor senare ger index 2.
    expect(weekIndexFromAnchor('2026-03-23', '2026-04-06')).toBe(2);
  });

  it('förblir korrekt över HÖSTENS DST-byte (fall-back, 25h-dag)', () => {
    // Sveriges fall-back 2026 = sista söndagen i oktober = 2026-10-25.
    // Ankare måndag 2026-10-19, air date 2026-10-26 = 7 dagar senare → index 1
    // trots 25-timmars-dagen i spannet.
    expect(weekIndexFromAnchor('2026-10-19', '2026-10-26')).toBe(1);
    expect(weekIndexFromAnchor('2026-10-19', '2026-10-24')).toBe(0); // dag 5
  });

  it('ger negativt index för datum före ankaret (caller klampar)', () => {
    expect(weekIndexFromAnchor('2026-03-23', '2026-03-22')).toBe(-1);
  });
});
