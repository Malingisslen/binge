import { describe, it, expect } from 'vitest';
import {
  SWEDISH_PROVIDERS,
  PROVIDER_MAP,
  getProvider,
  canonicalProviderId,
  getProviderColor,
} from './providers';

describe('SWEDISH_PROVIDERS catalog', () => {
  it('has at least the core Swedish streaming services', () => {
    const ids = SWEDISH_PROVIDERS.map(p => p.id);
    // Netflix, Prime, Disney+, HBO, Viaplay, SVT, TV4, Apple TV+
    expect(ids).toContain(8);    // Netflix
    expect(ids).toContain(119);  // Amazon Prime
    expect(ids).toContain(337);  // Disney+
    expect(ids).toContain(384);  // HBO Max
    expect(ids).toContain(76);   // Viaplay
    expect(ids).toContain(520);  // SVT Play
    expect(ids).toContain(489);  // TV4 Play (canonical id)
    expect(ids).toContain(350);  // Apple TV+
  });

  it('every flatrate provider has a non-negative default monthly cost', () => {
    for (const p of SWEDISH_PROVIDERS) {
      if (p.type === 'flatrate' && p.defaultMonthlyCost !== undefined) {
        expect(p.defaultMonthlyCost).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('every provider has a brand color in hex', () => {
    for (const p of SWEDISH_PROVIDERS) {
      expect(p.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('every tier id is unique within its provider', () => {
    for (const p of SWEDISH_PROVIDERS) {
      if (!p.tiers) continue;
      const tierIds = p.tiers.map(t => t.id);
      const unique = new Set(tierIds);
      expect(tierIds.length).toBe(unique.size);
    }
  });
});

describe('canonicalProviderId', () => {
  it('returns the canonical id for an alias (TV4 Play: 1944 → 489)', () => {
    expect(canonicalProviderId(1944)).toBe(489);
  });

  it('returns the same id for a canonical id', () => {
    expect(canonicalProviderId(489)).toBe(489);
    expect(canonicalProviderId(8)).toBe(8);   // Netflix
    expect(canonicalProviderId(337)).toBe(337); // Disney+
  });

  it('returns the input unchanged for unknown ids', () => {
    expect(canonicalProviderId(99999)).toBe(99999);
    expect(canonicalProviderId(0)).toBe(0);
  });
});

describe('getProvider', () => {
  it('finds a provider by canonical id', () => {
    expect(getProvider(8)?.name).toBe('Netflix');
    expect(getProvider(489)?.name).toBe('TV4 Play');
  });

  it('finds a provider by alias id', () => {
    // TV4 Play alias 1944 → same provider as 489
    expect(getProvider(1944)?.name).toBe('TV4 Play');
    expect(getProvider(1944)?.id).toBe(489);  // always returns canonical struct
  });

  it('returns undefined for unknown ids', () => {
    expect(getProvider(99999)).toBeUndefined();
  });
});

describe('getProviderColor', () => {
  it('returns the color for a known provider', () => {
    expect(getProviderColor(8)).toBe('#E50914'); // Netflix red
  });

  it('returns the canonical provider\'s color for an alias', () => {
    // alias 1944 resolves to TV4 Play (489) whose color is #E2001A
    expect(getProviderColor(1944)).toBe('#E2001A');
  });

  it('returns a fallback grey for unknown ids', () => {
    expect(getProviderColor(99999)).toBe('#888');
  });
});

describe('PROVIDER_MAP', () => {
  it('contains every canonical id', () => {
    for (const p of SWEDISH_PROVIDERS) {
      expect(PROVIDER_MAP.has(p.id)).toBe(true);
    }
  });

  it('contains every alias id mapped to the same provider struct', () => {
    for (const p of SWEDISH_PROVIDERS) {
      if (!p.aliases) continue;
      for (const alias of p.aliases) {
        expect(PROVIDER_MAP.get(alias)).toBe(p);
      }
    }
  });
});
