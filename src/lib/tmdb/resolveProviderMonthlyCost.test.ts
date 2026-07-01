import { describe, it, expect } from 'vitest';
import { resolveProviderMonthlyCost } from './providers';

// Netflix (id 8) has tiers basic 109 / standard 149 / premium 199, default 149.
// Prime (id 119) has NO tiers, default 69.
// SVT (id 520) is free, default 0.

describe('resolveProviderMonthlyCost — live tier pricing', () => {
  it('returns the CURRENT catalog tier price for a chosen tier (ignores frozen providerCosts)', () => {
    // Simulates an existing user with a stale frozen snapshot (199) in providerCosts
    // AND a chosen tier. Resolution must prefer the live tier price, not the snapshot.
    const cost = resolveProviderMonthlyCost(8, {
      providerTiers: { 8: 'premium' },
      providerCosts: { 8: 999 }, // stale/garbage frozen value — must be ignored
    });
    expect(cost).toBe(199);
  });

  it('uses a custom entered cost when no tier is chosen', () => {
    const cost = resolveProviderMonthlyCost(119, {
      providerTiers: {},
      providerCosts: { 119: 59 },
    });
    expect(cost).toBe(59);
  });

  it('falls back to defaultMonthlyCost when neither tier nor custom cost is set', () => {
    expect(resolveProviderMonthlyCost(119, { providerTiers: {}, providerCosts: {} })).toBe(69);
  });

  it('falls back to custom/default for an ORPHAN tier id no longer in the catalog', () => {
    // The monthly agent removed/renamed a tier; the user still points at the old id.
    // Must NOT return null/crash — fall through to custom, then default.
    expect(
      resolveProviderMonthlyCost(8, { providerTiers: { 8: 'gone-tier' }, providerCosts: { 8: 130 } }),
    ).toBe(130);
    expect(
      resolveProviderMonthlyCost(8, { providerTiers: { 8: 'gone-tier' }, providerCosts: {} }),
    ).toBe(149); // Netflix default
  });

  it('resolves an alias id to the canonical provider (TV4 Play 1944 → 489)', () => {
    // providerTiers/providerCosts are keyed by canonical id; a lookup by an alias
    // id must still resolve to the same provider + its chosen tier.
    const cost = resolveProviderMonthlyCost(1944, {
      providerTiers: { 489: 'plus' },
      providerCosts: {},
    });
    expect(cost).toBe(169); // TV4 Play 'plus' tier
  });

  it('returns 0 for a free service default', () => {
    expect(resolveProviderMonthlyCost(520, { providerTiers: {}, providerCosts: {} })).toBe(0);
  });

  it('returns null for an unknown provider id', () => {
    expect(resolveProviderMonthlyCost(999999, { providerTiers: {}, providerCosts: {} })).toBeNull();
  });

  it('tolerates missing maps (undefined tiers/costs)', () => {
    expect(resolveProviderMonthlyCost(119, {})).toBe(69);
  });
});
