import { describe, it, expect } from 'vitest';
import { attributeShowsToProviders, type AttributionProvider } from './useUpcomingShowsForAdvisor.helpers';

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
