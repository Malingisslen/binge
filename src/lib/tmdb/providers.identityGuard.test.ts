import { describe, it, expect } from 'vitest';
import { getProvider } from './providers';

/**
 * IDENTITY GUARD (BIN — automatisk prisuppdatering, must-have #1).
 *
 * The monthly price-update agent (and any human editing SWEDISH_PROVIDERS) may
 * change ONLY the numeric price fields (`cost` / `defaultMonthlyCost`) and ADD new
 * tiers/providers. It must NEVER rename, re-id, or remove an existing provider or
 * tier, because user profiles reference these by string/number key:
 *   - users/{uid}.providerTiers[providerId] = tierId   (a tier `id` string)
 *   - watchlist items store canonical provider ids (via aliases)
 *   - cheapestEntertainmentTier depends on `kind: 'sport'` staying put
 *
 * This baseline is the frozen identity contract. The test asserts every baseline
 * provider + tier still exists with the SAME identity (id/name/aliases/kind/flags).
 * Prices are deliberately NOT checked — they are the mutable field. Adding a new
 * provider or tier is allowed (the baseline is a subset check, not deep-equal).
 *
 * If this test fails, an edit touched immutable identity data. That change must go
 * through a human (a Linear ticket), NOT an auto-shipped price run. Do not "fix" the
 * test by editing the baseline unless the identity change is intentional and
 * migration-safe for existing user profiles.
 */

interface TierIdentity {
  name: string;
  kind: 'sport' | null;
}
interface ProviderIdentity {
  name: string;
  shortName: string;
  aliases: number[];
  isFree: boolean;
  isAds: boolean;
  tiers: Record<string, TierIdentity>;
}

const BASELINE: Record<number, ProviderIdentity> = {
  8: { name: 'Netflix', shortName: 'Netflix', aliases: [], isFree: false, isAds: false, tiers: {
    basic: { name: 'Basic', kind: null }, standard: { name: 'Standard', kind: null }, premium: { name: 'Premium', kind: null },
  } },
  119: { name: 'Amazon Prime Video', shortName: 'Prime', aliases: [], isFree: false, isAds: false, tiers: {} },
  337: { name: 'Disney+', shortName: 'Disney+', aliases: [], isFree: false, isAds: false, tiers: {
    ads: { name: 'Standard med reklam', kind: null }, standard: { name: 'Standard', kind: null }, premium: { name: 'Premium', kind: null },
  } },
  384: { name: 'Max', shortName: 'HBO', aliases: [1899, 1825], isFree: false, isAds: false, tiers: {
    ads: { name: 'Basic med reklam', kind: null }, standard: { name: 'Standard', kind: null }, premium: { name: 'Premium', kind: null },
  } },
  76: { name: 'Viaplay', shortName: 'Viaplay', aliases: [], isFree: false, isAds: false, tiers: {
    reklam: { name: 'Film & Serier med reklam', kind: null }, standard: { name: 'Film & Serier', kind: null },
    medium: { name: 'Medium (inkl. sport)', kind: 'sport' }, total: { name: 'Total (all sport)', kind: 'sport' },
  } },
  520: { name: 'SVT Play', shortName: 'SVT', aliases: [493], isFree: true, isAds: false, tiers: {} },
  489: { name: 'TV4 Play', shortName: 'TV4 Play', aliases: [1944, 1759], isFree: false, isAds: false, tiers: {
    'plus-ads': { name: 'Plus med reklam', kind: null }, plus: { name: 'Plus utan reklam', kind: null },
    sport: { name: 'Sport Total utan reklam', kind: 'sport' },
  } },
  350: { name: 'Apple TV+', shortName: 'Apple', aliases: [2243], isFree: false, isAds: false, tiers: {} },
  510: { name: 'Discovery+', shortName: 'Disc+', aliases: [], isFree: false, isAds: false, tiers: {
    ads: { name: 'Underhållning (med reklam)', kind: null }, standard: { name: 'Underhållning', kind: null },
    sport: { name: 'Underhållning + Sport', kind: 'sport' },
  } },
  323: { name: 'Crunchyroll', shortName: 'CR', aliases: [1968, 283], isFree: false, isAds: false, tiers: {
    fan: { name: 'Fan', kind: null }, megafan: { name: 'Mega Fan', kind: null },
  } },
  431: { name: 'SkyShowtime', shortName: 'Sky', aliases: [1773, 531], isFree: false, isAds: false, tiers: {
    ads: { name: 'Standard med annonser', kind: null }, standard: { name: 'Standard', kind: null }, premium: { name: 'Premium', kind: null },
  } },
  335: { name: 'YouTube Premium', shortName: 'YT', aliases: [188], isFree: false, isAds: false, tiers: {
    student: { name: 'Student', kind: null }, solo: { name: 'Enskild', kind: null }, family: { name: 'Familj', kind: null },
  } },
  521: { name: 'Tele2 Play', shortName: 'Tele2', aliases: [497], isFree: false, isAds: false, tiers: {} },
  300: { name: 'Pluto TV', shortName: 'Pluto', aliases: [], isFree: false, isAds: true, tiers: {} },
  578: { name: 'TriArt Play', shortName: 'TriArt', aliases: [517], isFree: false, isAds: false, tiers: {} },
  35: { name: 'Rakuten TV', shortName: 'Rakuten', aliases: [], isFree: false, isAds: false, tiers: {} },
  3: { name: 'Google Play Movies', shortName: 'Google', aliases: [], isFree: false, isAds: false, tiers: {} },
  2: { name: 'Apple TV', shortName: 'Apple', aliases: [], isFree: false, isAds: false, tiers: {} },
  426: { name: 'SF Anytime', shortName: 'SF Anytime', aliases: [], isFree: false, isAds: false, tiers: {} },
};

describe('SWEDISH_PROVIDERS identity guard (immutable id/name/kind — prices may change freely)', () => {
  for (const [idStr, expected] of Object.entries(BASELINE)) {
    const id = Number(idStr);
    it(`preserves the identity of provider ${id} (${expected.name})`, () => {
      const p = getProvider(id);
      expect(p, `provider ${id} (${expected.name}) was removed`).toBeDefined();
      if (!p) return;
      expect(p.id, `provider ${id} canonical id changed`).toBe(id);
      expect(p.name).toBe(expected.name);
      expect(p.shortName).toBe(expected.shortName);
      expect([...(p.aliases ?? [])].sort((a, b) => a - b)).toEqual([...expected.aliases].sort((a, b) => a - b));
      expect(Boolean(p.isFree)).toBe(expected.isFree);
      expect(Boolean(p.isAds)).toBe(expected.isAds);

      for (const [tierId, tExpected] of Object.entries(expected.tiers)) {
        const tier = p.tiers?.find(t => t.id === tierId);
        expect(tier, `tier '${tierId}' of ${expected.name} was removed/renamed`).toBeDefined();
        if (!tier) continue;
        expect(tier.name).toBe(tExpected.name);
        expect(tier.kind ?? null, `tier '${tierId}' of ${expected.name} changed sport/kind class`).toBe(tExpected.kind);
      }
    });
  }

  it('every alias resolves to its canonical provider (no orphaned alias)', () => {
    for (const [idStr, expected] of Object.entries(BASELINE)) {
      const id = Number(idStr);
      for (const alias of expected.aliases) {
        expect(getProvider(alias)?.id, `alias ${alias} no longer maps to ${id}`).toBe(id);
      }
    }
  });
});
