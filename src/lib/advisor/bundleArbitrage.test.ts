import { describe, it, expect } from 'vitest';
import { getProvider } from '@/lib/tmdb/providers';
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
    id: 'test-bundle',
    name: 'Testpaket',
    vendor: 'TestCo',
    verifiedDate: '2026-07-01',
    ...extra, // incl. includedTiers (BIN-433)
    monthlyKr,
    includedProviderIds,
  };
}

// Standard-tier declarations for the classic three-service fixtures — BIN-433 made
// an omitted tier key on a TIERED provider "not comparable" (curation fail-safe),
// so fixtures declare tiers explicitly. Standard tiers price-match the defaults
// (169/109/149), keeping every original BIN-183 expectation identical.
const STD3 = { 8: 'standard', 337: 'standard', 384: 'standard' };

describe('detectBundleArbitrage (BIN-183)', () => {
  it('suggests a bundle that beats the à-la-carte cost of ≥2 owned paid services', () => {
    // Owns Netflix(169) + Disney+(109) + Max(149) = 427 à-la-carte; bundle at 349.
    const out = detectBundleArbitrage([8, 337, 384], {}, [fixture(349, [8, 337, 384], { includedTiers: STD3 })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 337, 384]);
    expect(out[0].currentKr).toBe(427);
    expect(out[0].bundleKr).toBe(349);
    expect(out[0].savingKr).toBe(78);
  });

  it('does NOT suggest when the bundle overlaps only ONE owned service (a downgrade, not arbitrage)', () => {
    // Owns Netflix only among the bundle's members → 1 overlap.
    const out = detectBundleArbitrage([8], {}, [fixture(50, [8, 337, 384], { includedTiers: STD3 })], NOW);
    expect(out).toEqual([]);
  });

  it('does NOT suggest at break-even or worse (saving must be strictly positive)', () => {
    expect(detectBundleArbitrage([8, 337, 384], {}, [fixture(427, [8, 337, 384], { includedTiers: STD3 })], NOW)).toEqual([]); // == 0
    expect(detectBundleArbitrage([8, 337, 384], {}, [fixture(500, [8, 337, 384], { includedTiers: STD3 })], NOW)).toEqual([]); // < 0
  });

  it('never folds bonus-service value into savingKr', () => {
    // Bundle adds Viaplay(76), which the user does NOT own — pure bonus.
    const out = detectBundleArbitrage([8, 337, 384], {}, [fixture(349, [8, 337, 384, 76], { includedTiers: { ...STD3, 76: 'standard' } })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].savingKr).toBe(78); // 427 − 349, NOT 427+169 − 349
    expect(out[0].bonusProviderIds).toEqual([76]);
    expect(out[0].bonusNames).toEqual(['Viaplay']);
    expect(out[0].replacedProviderIds).not.toContain(76);
  });

  it('canonicalises + de-dups alias ids in a bundle (no double-count)', () => {
    // Bundle lists TV4 Play twice (489 + alias 1944) + Netflix. Owns TV4 + Netflix.
    const out = detectBundleArbitrage([489, 8], {}, [fixture(250, [489, 1944, 8], { includedTiers: { 489: 'plus', 8: 'standard' } })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 489]); // TV4 counted ONCE
    expect(out[0].currentKr).toBe(338); // 169 + 169, not 169+169+169
    expect(out[0].savingKr).toBe(88);
  });

  it('matches an alias id in the OWNED set against the canonical bundle id', () => {
    // User owns TV4 via alias 1944; bundle lists canonical 489.
    const out = detectBundleArbitrage([1944, 8], {}, [fixture(250, [489, 8], { includedTiers: { 489: 'plus', 8: 'standard' } })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 489]);
    expect(out[0].currentKr).toBe(338);
  });

  it('drops uncatalogued/phantom provider ids — never replaced, never a bonus', () => {
    const out = detectBundleArbitrage([8, 337], {}, [fixture(200, [8, 337, 999999], { includedTiers: STD3 })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].replacedProviderIds).not.toContain(999999);
    expect(out[0].bonusProviderIds).not.toContain(999999);
    expect(out[0].currentKr).toBe(278); // 169 + 109 only
  });

  it('is campaign-aware via the required `now`: a live promo can suppress a suggestion that a lapsed one restores', () => {
    const user = { providerCampaigns: { 8: { monthlyCost: 29, endDate: '2026-10-01' } } };
    const bundle = fixture(349, [8, 337, 384], { includedTiers: STD3 });
    // Promo active: Netflix 29 → à-la-carte 29+109+149 = 287 < 349 → no honest saving.
    expect(detectBundleArbitrage([8, 337, 384], user, [bundle], NOW)).toEqual([]);
    // After the promo lapses: Netflix reverts to 169 → 427 > 349 → the saving appears.
    const dayAfter = new Date(2026, 9, 2); // 2026-10-02
    const out = detectBundleArbitrage([8, 337, 384], user, [bundle], dayAfter);
    expect(out).toHaveLength(1);
    expect(out[0].savingKr).toBe(78);
  });

  it('excludes free / ads / user-zeroed services from the replaced set', () => {
    // SVT Play (520, free) inside the bundle is never a "replaced" paid service.
    const free = detectBundleArbitrage([520, 8, 337], {}, [fixture(200, [520, 8, 337], { includedTiers: STD3 })], NOW);
    expect(free[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 337]);
    expect(free[0].currentKr).toBe(278);

    // Pluto TV (300, isAds, cost 0) likewise excluded.
    const ads = detectBundleArbitrage([300, 8, 337], {}, [fixture(200, [300, 8, 337], { includedTiers: STD3 })], NOW);
    expect(ads[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 337]);

    // A user-zeroed custom cost drops that service → only 1 real paid overlap → no suggestion.
    const zeroed = detectBundleArbitrage([8, 337], { providerCosts: { 8: 0 } }, [fixture(50, [8, 337], { includedTiers: STD3 })], NOW);
    expect(zeroed).toEqual([]);
  });

  it('returns mutually-exclusive alternatives sorted by saving desc; overlapping bundles both surface', () => {
    const cheap = fixture(300, [8, 337, 384], { id: 'big', name: 'Stor', includedTiers: STD3 }); // saving 127
    const dear = fixture(349, [8, 337, 384], { id: 'small', name: 'Liten', includedTiers: STD3 }); // saving 78
    const out = detectBundleArbitrage([8, 337, 384], {}, [dear, cheap], NOW);
    expect(out.map((s) => s.bundle.id)).toEqual(['big', 'small']); // best-first, both returned
    expect(out.map((s) => s.savingKr)).toEqual([127, 78]);
  });

  it('flags a suggestion whose bundle price is past the staleness horizon', () => {
    const old = detectBundleArbitrage([8, 337, 384], {}, [fixture(349, [8, 337, 384], { verifiedDate: '2025-01-01', includedTiers: STD3 })], NOW);
    expect(old[0].stale).toBe(true);
    const fresh = detectBundleArbitrage([8, 337, 384], {}, [fixture(349, [8, 337, 384], { verifiedDate: '2026-07-01', includedTiers: STD3 })], NOW);
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

describe('tier-aware comparison (BIN-433)', () => {
  it('never coerces an unknown user cost to 0 — skipped from replaced AND downgrade (AC1)', () => {
    // TriArt (578) is rent-type: no tiers, no default → resolveEffectiveMonthlyCost null.
    // NB (test review 2026-07-07): with TODAY'S catalog this guard is defense-in-depth —
    // any provider whose user cost resolves null also lacks tiers/default, so
    // bundleTierPriceOf independently returns null and skips it. The guard exists so a
    // FUTURE catalog shape (tiered provider without default) can't fabricate a 0-cost
    // "win"; it cannot be pinned by mutation against the real catalog.
    const out = detectBundleArbitrage([578, 8, 337], {}, [fixture(100, [578, 8, 337], { includedTiers: STD3 })], NOW);
    expect(out).toHaveLength(1); // gate passes on the TWO priced services alone
    expect(out[0].replacedProviderIds).not.toContain(578);
    expect(out[0].downgradeProviderIds).not.toContain(578);
    expect(out[0].currentKr).toBe(278); // 169 + 109 — never 0-inflated by TriArt
  });

  it('an active promo can never mask a hidden tier downgrade — classification is tier-vs-tier', () => {
    // high-review 2026-07-07: user on ad-free Max 'standard' (149 catalog) with a live
    // promo at 79 — CHEAPER than the bundle's ads tier (89). A price-proxy would call
    // that "replaced"; the tier truth is a hidden downgrade to ads.
    const bundle = fixture(200, [8, 337, 384], { includedTiers: { 8: 'standard', 337: 'ads', 384: 'ads' } });
    const user = {
      providerTiers: { 337: 'ads', 384: 'standard' },
      providerCampaigns: { 384: { monthlyCost: 79, endDate: '2026-10-01' } },
    };
    const out = detectBundleArbitrage([8, 337, 384], user, [bundle], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].downgradeProviderIds).toEqual([384]); // the promo never hides the tier drop
    expect(out[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 337]);
    expect(out[0].currentKr).toBe(238); // 169 + 69 — promo-Max never counted
  });

  it('a grandfathered custom price above the bundle tier is NOT COMPARABLE — no downgrade label, no fabricated saving', () => {
    // high-review 2026-07-07: a custom 199 kr Netflix (no tier chosen) says nothing
    // about the user's LEVEL — "ingår men i lägre nivå" would be an unsupported claim.
    const user = { providerCosts: { 8: 199 }, providerTiers: { 337: 'ads', 384: 'ads' } };
    const bundle = fixture(100, [8, 337, 384], { includedTiers: { 8: 'standard', 337: 'ads', 384: 'ads' } });
    const out = detectBundleArbitrage([8, 337, 384], user, [bundle], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([337, 384]);
    expect(out[0].downgradeProviderIds).toEqual([]); // never the unsupported label
    expect(out[0].currentKr).toBe(158); // 69 + 89 — the 199 custom never inflates a saving
  });

  it('an omitted tier key on a TIERED provider is a curation error → not comparable, never sold as ad-free', () => {
    // high-review 2026-07-07: falling back to defaultMonthlyCost (= the ad-free
    // standard price) would sell an unknown bundle tier as ad-free. Max's key omitted:
    const bundle = fixture(150, [8, 337, 384], { includedTiers: { 8: 'standard', 337: 'ads' } });
    const user = { providerTiers: { 337: 'ads', 384: 'standard' } };
    const out = detectBundleArbitrage([8, 337, 384], user, [bundle], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 337]);
    expect(out[0].replacedProviderIds).not.toContain(384);
    expect(out[0].downgradeProviderIds).toEqual([]); // skipped from BOTH buckets
    expect(out[0].currentKr).toBe(238);
  });

  it('user cost EXACTLY at the bundle tier price is replaced, not downgrade (AC2, pins <=)', () => {
    const bundle = fixture(120, [384, 337], { includedTiers: { 384: 'ads', 337: 'ads' } });
    const user = { providerTiers: { 384: 'ads', 337: 'ads' } }; // Max ads 89, Disney ads 69
    const out = detectBundleArbitrage([384, 337], user, [bundle], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([337, 384]);
    expect(out[0].downgradeProviderIds).toEqual([]);
    expect(out[0].currentKr).toBe(158); // 89 + 69
  });

  it('an orphan tier id fail-safes to NOT COMPARABLE — never a fabricated saving (AC3)', () => {
    const bundle = fixture(100, [8, 337, 384], { includedTiers: { 8: 'tier-that-does-not-exist', 337: 'ads', 384: 'ads' } });
    const user = { providerTiers: { 337: 'ads', 384: 'ads' } };
    const out = detectBundleArbitrage([8, 337, 384], user, [bundle], NOW);
    expect(out).toHaveLength(1); // 337+384 still clear the gate
    expect(out[0].replacedProviderIds).not.toContain(8);
    expect(out[0].downgradeProviderIds).not.toContain(8); // skipped from BOTH buckets
    expect(out[0].currentKr).toBe(158);
  });

  it('an OMITTED tier key means the untiered base offering — a distinct path from orphan (AC4)', () => {
    // Prime (119) has no tiers[]; omitted from includedTiers → defaultMonthlyCost 69.
    const bundle = fixture(200, [119, 8], { includedTiers: { 8: 'standard' } });
    const out = detectBundleArbitrage([119, 8], {}, [bundle], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 119]); // 69 <= 69 replaced
    expect(out[0].currentKr).toBe(238); // 69 + 169
  });

  it('a downgrade cannot carry a bundle over the ≥2 gate (AC5 gate discrimination)', () => {
    // 1 replaced + 1 downgrade must NOT clear the gate — the fixture that actually
    // discriminates a `replaced + downgrades >= 2` mutation.
    const bundle = fixture(100, [8, 384], { includedTiers: { 8: 'standard', 384: 'ads' } });
    const user = { providerTiers: { 384: 'standard' } }; // Max ad-free 149 > bundle-ads 89 → downgrade
    expect(detectBundleArbitrage([8, 384], user, [bundle], NOW)).toEqual([]);
  });

  it('downgrades never count toward currentKr or savingKr (AC5)', () => {
    // User pays ad-free Max standard (149); bundle only carries Max 'ads' (89) → downgrade.
    const bundle = fixture(200, [8, 337, 384], { includedTiers: { 8: 'standard', 337: 'ads', 384: 'ads' } });
    const user = { providerTiers: { 337: 'ads', 384: 'standard' } };
    const out = detectBundleArbitrage([8, 337, 384], user, [bundle], NOW);
    expect(out).toHaveLength(1); // gate passes on replaced.length === 2 alone
    expect(out[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 337]);
    expect(out[0].downgradeProviderIds).toEqual([384]);
    expect(out[0].downgradeNames).toEqual(['Max']);
    expect(out[0].currentKr).toBe(238); // 169 + 69 — Max's 149 NOT included
    expect(out[0].savingKr).toBe(38); // 238 − 200, downgrade never folded in
  });

  it('an alias-KEYED includedTiers entry resolves to the canonical provider', () => {
    // Bundle data keyed by Max's legacy alias 1899 — canonicalTierMap must land it on
    // 384. Discriminating under the BIN-433 engine: stripping alias resolution leaves
    // Max's tier key unresolved → omitted-on-tiered → NOT comparable → gate fails.
    const bundle = fixture(150, [8, 384], { includedTiers: { 8: 'standard', 1899: 'ads' } });
    const user = { providerTiers: { 384: 'ads' } }; // user on Max ads 89 → 89 <= 89 → replaced
    const out = detectBundleArbitrage([8, 384], user, [bundle], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 384]);
    expect(out[0].currentKr).toBe(258); // 169 + 89 — the alias-keyed tier applied
  });

  it('canonicalTierMap: a canonical-keyed entry beats an alias-keyed one regardless of order', () => {
    // Both 1899 (alias, 'ads') and 384 (canonical, 'standard') present → canonical wins.
    const bundle = fixture(200, [8, 384], { includedTiers: { 8: 'standard', 1899: 'ads', 384: 'standard' } });
    const user = { providerTiers: { 384: 'standard' } }; // 149 <= standard 149 → replaced, NOT downgraded vs ads
    const out = detectBundleArbitrage([8, 384], user, [bundle], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].replacedProviderIds.sort((a, b) => a - b)).toEqual([8, 384]);
    expect(out[0].downgradeProviderIds).toEqual([]);
    expect(out[0].currentKr).toBe(318); // 169 + 149
  });

  it('a downgrade via an alias id lands canonical, once (AC6)', () => {
    // Max via legacy alias 1899; user on ad-free standard vs bundle 'ads'.
    const bundle = fixture(150, [8, 1899], { includedTiers: { 8: 'standard', 384: 'ads' } });
    const user = { providerTiers: { 384: 'standard' } };
    const out = detectBundleArbitrage([1899, 8, 337], user, [bundle], NOW);
    // Only Netflix replaced → gate FAILS (1 < 2) → no suggestion; prove via a 3rd service.
    expect(out).toEqual([]);
    const bundle2 = fixture(200, [8, 337, 1899], { includedTiers: { 8: 'standard', 337: 'ads', 384: 'ads' } });
    const out2 = detectBundleArbitrage([1899, 8, 337], { providerTiers: { 337: 'ads', 384: 'standard' } }, [bundle2], NOW);
    expect(out2[0].downgradeProviderIds).toEqual([384]); // canonical id, exactly once
  });
});

describe('SWEDISH_BUNDLES seed integrity (BIN-429 verification → BIN-433 seeds)', () => {
  it('seeds the three live-verified Telia bundles at their exact ordinary prices (2026-07-07)', () => {
    expect(SWEDISH_BUNDLES.map(b => b.id).sort()).toEqual([
      'telia-streaming-maxad', 'telia-streaming-mer', 'telia-streaming-mest',
    ]);
    // Every seeded price pinned exactly — a typo'd real-money number must go red
    // (high-review 2026-07-07: an ordering assertion alone left Maxad unpinned).
    expect(SWEDISH_BUNDLES.find(b => b.id === 'telia-streaming-mer')?.monthlyKr).toBe(269);
    expect(SWEDISH_BUNDLES.find(b => b.id === 'telia-streaming-maxad')?.monthlyKr).toBe(319);
    expect(SWEDISH_BUNDLES.find(b => b.id === 'telia-streaming-mest')?.monthlyKr).toBe(499);
  });

  it('every TIERED included provider declares its tier — a curation slip cannot inherit the ad-free default', () => {
    // Companion canary to the engine's omitted-on-tiered fail-safe: the engine skips
    // such providers (never sells ads as ad-free), and THIS makes the curation slip
    // loud at test time instead of silently shrinking coverage.
    for (const b of SWEDISH_BUNDLES) {
      for (const id of b.includedProviderIds) {
        const p = getProvider(id);
        if (p?.tiers?.length) {
          expect(
            b.includedTiers?.[id],
            `${b.id}: ${p.name} has catalog tiers but no includedTiers entry — declare the verified tier`,
          ).toBeDefined();
        }
      }
    }
  });

  it('every includedTiers entry names a REAL catalog tier on an included provider (AC3 canary)', () => {
    // Loud data-integrity gate: a tier the price agent renames/removes turns this red
    // instead of silently degrading comparisons (same discipline as the stale canary).
    for (const b of SWEDISH_BUNDLES) {
      for (const [k, tierId] of Object.entries(b.includedTiers ?? {})) {
        const id = Number(k);
        expect(b.includedProviderIds, `${b.id}: tier key ${id} not among includedProviderIds`).toContain(id);
        const provider = getProvider(id);
        expect(provider, `${b.id}: tier key ${id} not in catalog`).toBeDefined();
        expect(
          provider?.tiers?.some(t => t.id === tierId),
          `${b.id}: tier '${tierId}' missing on ${provider?.name} — catalog renamed it? Re-verify per BIN-429`,
        ).toBe(true);
      }
    }
  });

  it('freshness canary: no seeded bundle may be already stale (fails loudly as data ages)', () => {
    // Intentionally uses the real clock — turns red when a seed drifts past
    // BUNDLE_STALE_DAYS, forcing re-verification (price, contents AND tier mix).
    const now = new Date();
    for (const b of SWEDISH_BUNDLES) {
      expect(Number.isNaN(new Date(b.verifiedDate).getTime()), `${b.id} has an invalid verifiedDate`).toBe(false);
      expect(isBundleStale(b.verifiedDate, now), `${b.id} is stale — re-verify per BIN-429`).toBe(false);
    }
  });

  it('the verified worked example reproduces against the REAL catalog (AC8)', () => {
    // Exact-match household: owns all six Mest services at precisely the bundle's tiers.
    const user = {
      providerTiers: { 8: 'standard', 384: 'ads', 337: 'ads', 489: 'plus', 76: 'standard' },
    }; // Prime 119 untiered → catalog default 69
    const out = detectBundleArbitrage([8, 384, 337, 119, 489, 76], user, SWEDISH_BUNDLES, NOW);
    expect(out.map(s => s.bundle.id)).toEqual([
      'telia-streaming-mest',   // 734 − 499 = 235
      'telia-streaming-maxad',  // 396 − 319 = 77
      'telia-streaming-mer',    // 327 − 269 = 58  ← matches Telia's own "spara 58 kr" claim
    ]);
    expect(out[0].currentKr).toBe(734);
    expect(out[0].savingKr).toBe(235);
    expect(out[0].downgradeProviderIds).toEqual([]);
    expect(out[0].bonusProviderIds).toEqual([]);
    // ALL THREE savings pinned exactly (high-review: ordering alone left Maxad's
    // number free to drift anywhere between its neighbours).
    expect(out[1].currentKr).toBe(396);
    expect(out[1].savingKr).toBe(77);
    expect(out[2].currentKr).toBe(327);
    expect(out[2].savingKr).toBe(58);
  });
});
