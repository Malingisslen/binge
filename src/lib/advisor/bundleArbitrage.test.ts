import { describe, it, expect } from 'vitest';
import {
  detectBundleArbitrage,
  isBundleStale,
  SWEDISH_BUNDLES,
  BUNDLE_STALE_DAYS,
  type SwedishBundle,
} from './bundleArbitrage';

// Real catalog ids used below (defaults via resolveProviderMonthlyCost, no tier):
//   Netflix 8 = 169 · Disney+ 337 = 109 · Max 384 = 149 · Viaplay 76 = 169
//   TV4 Play 489 = 169 (alias 1944) · SVT Play 520 = 0 (free) · Pluto TV 300 = 0 (ads)
const NOW = new Date(2026, 6, 4); // 2026-07-04 local (Stockholm under test TZ)

function fixture(
  monthlyKr: number,
  includedProviderIds: number[],
  extra: Partial<SwedishBundle> = {},
): SwedishBundle {
  return {
    id: extra.id ?? 'test-bundle',
    name: extra.name ?? 'Testpaket',
    vendor: extra.vendor ?? 'TestCo',
    monthlyKr,
    includedProviderIds,
    verifiedDate: extra.verifiedDate ?? '2026-07-01',
    url: extra.url,
  };
}

describe('detectBundleArbitrage (BIN-183)', () => {
  it('suggests a bundle that beats the à-la-carte cost of ≥2 owned paid services', () => {
    // Owns Netflix(169) + Disney+(109) + Max(149) = 427 à-la-carte; bundle at 349.
    const out = detectBundleArbitrage([8, 337, 384], {}, [fixture(349, [8, 337, 384])], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 337, 384]);
    expect(out[0].currentKr).toBe(427);
    expect(out[0].bundleKr).toBe(349);
    expect(out[0].savingKr).toBe(78);
  });

  it('does NOT suggest when the bundle overlaps only ONE owned service (a downgrade, not arbitrage)', () => {
    // Owns Netflix only among the bundle's members → 1 overlap.
    const out = detectBundleArbitrage([8], {}, [fixture(50, [8, 337, 384])], NOW);
    expect(out).toEqual([]);
  });

  it('does NOT suggest at break-even or worse (saving must be strictly positive)', () => {
    expect(detectBundleArbitrage([8, 337, 384], {}, [fixture(427, [8, 337, 384])], NOW)).toEqual([]); // == 0
    expect(detectBundleArbitrage([8, 337, 384], {}, [fixture(500, [8, 337, 384])], NOW)).toEqual([]); // < 0
  });

  it('never folds bonus-service value into savingKr (AC2)', () => {
    // Bundle adds Viaplay(76), which the user does NOT own — pure bonus.
    const out = detectBundleArbitrage([8, 337, 384], {}, [fixture(349, [8, 337, 384, 76])], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].savingKr).toBe(78); // 427 − 349, NOT 427+169 − 349
    expect(out[0].bonusProviderIds).toEqual([76]);
    expect(out[0].bonusNames).toEqual(['Viaplay']);
    expect(out[0].replacedProviderIds).not.toContain(76);
  });

  it('canonicalises + de-dups alias ids in a bundle (no double-count) (AC3)', () => {
    // Bundle lists TV4 Play twice (489 + alias 1944) + Netflix. Owns TV4 + Netflix.
    const out = detectBundleArbitrage([489, 8], {}, [fixture(250, [489, 1944, 8])], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 489]); // TV4 counted ONCE
    expect(out[0].currentKr).toBe(338); // 169 + 169, not 169+169+169
    expect(out[0].savingKr).toBe(88);
  });

  it('matches an alias id in the OWNED set against the canonical bundle id (AC3)', () => {
    // User owns TV4 via alias 1944; bundle lists canonical 489.
    const out = detectBundleArbitrage([1944, 8], {}, [fixture(250, [489, 8])], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 489]);
    expect(out[0].currentKr).toBe(338);
  });

  it('drops uncatalogued/phantom provider ids — never replaced, never a bonus (AC4)', () => {
    const out = detectBundleArbitrage([8, 337], {}, [fixture(200, [8, 337, 999999])], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].replacedProviderIds).not.toContain(999999);
    expect(out[0].bonusProviderIds).not.toContain(999999);
    expect(out[0].currentKr).toBe(278); // 169 + 109 only
  });

  it('is campaign-aware via the required `now`: a live promo can suppress a suggestion that a lapsed one restores (AC5)', () => {
    const user = { providerCampaigns: { 8: { monthlyCost: 29, endDate: '2026-10-01' } } };
    const bundle = fixture(349, [8, 337, 384]);
    // Promo active: Netflix 29 → à-la-carte 29+109+149 = 287 < 349 → no honest saving.
    expect(detectBundleArbitrage([8, 337, 384], user, [bundle], NOW)).toEqual([]);
    // After the promo lapses: Netflix reverts to 169 → 427 > 349 → the saving appears.
    const dayAfter = new Date(2026, 9, 2); // 2026-10-02
    const out = detectBundleArbitrage([8, 337, 384], user, [bundle], dayAfter);
    expect(out).toHaveLength(1);
    expect(out[0].savingKr).toBe(78);
  });

  it('excludes free / ads / user-zeroed services from the replaced set (AC9)', () => {
    // SVT Play (520, free) inside the bundle is never a "replaced" paid service.
    const free = detectBundleArbitrage([520, 8, 337], {}, [fixture(200, [520, 8, 337])], NOW);
    expect(free[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 337]);
    expect(free[0].currentKr).toBe(278);

    // Pluto TV (300, isAds, cost 0) likewise excluded.
    const ads = detectBundleArbitrage([300, 8, 337], {}, [fixture(200, [300, 8, 337])], NOW);
    expect(ads[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 337]);

    // A user-zeroed custom cost drops that service → only 1 real paid overlap → no suggestion.
    const zeroed = detectBundleArbitrage([8, 337], { providerCosts: { 8: 0 } }, [fixture(50, [8, 337])], NOW);
    expect(zeroed).toEqual([]);
  });

  it('returns mutually-exclusive alternatives sorted by saving desc; overlapping bundles both surface (AC7)', () => {
    const cheap = fixture(300, [8, 337, 384], { id: 'big', name: 'Stor' }); // saving 127
    const dear = fixture(349, [8, 337, 384], { id: 'small', name: 'Liten' }); // saving 78
    const out = detectBundleArbitrage([8, 337, 384], {}, [dear, cheap], NOW);
    expect(out.map((s) => s.bundle.id)).toEqual(['big', 'small']); // best-first, both returned
    expect(out.map((s) => s.savingKr)).toEqual([127, 78]);
  });

  it('flags a suggestion whose bundle price is past the staleness horizon (AC6)', () => {
    const old = detectBundleArbitrage([8, 337, 384], {}, [fixture(349, [8, 337, 384], { verifiedDate: '2025-01-01' })], NOW);
    expect(old[0].stale).toBe(true);
    const fresh = detectBundleArbitrage([8, 337, 384], {}, [fixture(349, [8, 337, 384], { verifiedDate: '2026-07-01' })], NOW);
    expect(fresh[0].stale).toBe(false);
  });
});

describe('isBundleStale (BIN-183)', () => {
  it('is false within the threshold and true past it', () => {
    expect(isBundleStale('2026-07-04', new Date(2026, 6, 4))).toBe(false); // age ~0
    expect(isBundleStale('2026-07-04', new Date(2027, 2, 1))).toBe(true); // ~240 days later
  });

  it('treats a malformed date as STALE (fail-safe — an unverifiable price must not hide)', () => {
    expect(isBundleStale('not-a-date', new Date(2026, 6, 4))).toBe(true);
    expect(isBundleStale('', new Date(2026, 6, 4))).toBe(true);
  });

  it('uses BUNDLE_STALE_DAYS (180) as the default window', () => {
    expect(BUNDLE_STALE_DAYS).toBe(180);
  });

  it('treats the exact 180-day boundary as fresh, 181 as stale (pins > vs >=)', () => {
    const verified = '2026-07-04';
    const base = new Date(verified).getTime();
    const at180 = new Date(base + 180 * 86_400_000);
    const at181 = new Date(base + 181 * 86_400_000);
    expect(isBundleStale(verified, at180)).toBe(false); // exactly at the window → not yet stale
    expect(isBundleStale(verified, at181)).toBe(true); // one day past → stale
  });
});

describe('SWEDISH_BUNDLES seed honesty (BIN-183 / BIN-429)', () => {
  it('ships EMPTY until verified data is curated (AFFILIATE_PROGRAMS precedent, BIN-429)', () => {
    // When BIN-429 populates this, replace with real entries — the freshness canary
    // below then guards them. Keeping it empty documents the honest "no unverified
    // real-money numbers" state.
    expect(SWEDISH_BUNDLES).toEqual([]);
  });

  it('freshness canary: no seeded bundle may be already stale (fails loudly as data ages)', () => {
    // Intentionally uses the real clock — this is a canary, not a logic test. It stays
    // green while the seed is empty, and turns red the moment a curated bundle drifts
    // past BUNDLE_STALE_DAYS, forcing re-verification (BIN-429 curation discipline).
    const now = new Date();
    for (const b of SWEDISH_BUNDLES) {
      expect(Number.isNaN(new Date(b.verifiedDate).getTime()), `${b.id} has an invalid verifiedDate`).toBe(false);
      expect(isBundleStale(b.verifiedDate, now), `${b.id} is stale — re-verify per BIN-429`).toBe(false);
    }
  });
});
