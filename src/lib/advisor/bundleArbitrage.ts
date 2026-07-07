// BIN-183 — "Bundle arbitrage": detect when a user's separately-paid streaming
// services would be cheaper bought as a Swedish telecom/streamer BUNDLE (e.g.
// "dina 3 lösa tjänster för 760 kr finns i Telia Streaming Mest för 499 → spara
// 261 kr/mån"). Pure + client-side over the user's persisted cost settings — no
// TMDB calls. The runtime cousin of listOptimizer/spendSnapshot: same honesty
// bar (every kr is a subscription cost we actually know) and the same
// canonical + campaign-aware cost plumbing (resolveEffectiveMonthlyCost).
//
// This is a REAL-MONEY recommendation surface, so the seed-data rules are strict
// (role #28 stakeholder reviews, BIN-183 + BIN-433):
//   1. SWEDISH_BUNDLES prices are the ORDINARY standing rate, never an intro /
//      campaign teaser — the same bar providers.ts holds for defaultMonthlyCost.
//      A bundle whose only known price is a temporary promo does NOT go in.
//   2. TIER-AWARE comparison (BIN-433, replaces the original binary tier bar with
//      role #28's sign-off): every bundle declares WHICH tier of each service it
//      includes (includedTiers). Classification compares LEVELS, never volatile
//      prices: a user's CHOSEN tier is compared catalog-price-vs-catalog-price
//      (campaign-immune — a live promo can't mask a hidden downgrade); a user
//      with NO chosen tier is compared via their ORDINARY price as proxy, and a
//      HIGHER custom price is NOT COMPARABLE (skipped — level unknowable). A
//      service the bundle carries at a LOWER tier goes in a separate qualitative
//      downgrade bucket ("ingår men i lägre nivå") and NEVER into savingKr or
//      the ≥2 gate; currentKr uses the user's EFFECTIVE cost for replaced
//      services (an active promo honestly shrinks the claimed saving). Live
//      verification 2026-07-07 (BIN-429) showed every Swedish bundle rests on
//      ad tiers — this rule is what lets the engine serve exactly the users
//      those bundles genuinely fit.
//   3. Seed only what is live-verified (dated + sourced), exactly like the price
//      comments in providers.ts — price, contents AND tier mix. A test fails
//      loudly if a seeded bundle is stale or names a tier id the catalog lacks.
//
// The advisor UI that surfaces these is a separate Tier-B follow-up (BIN-430); the
// engine ships without a consumer yet, like applyAffiliate + AFFILIATE_PROGRAMS
// in providers.ts.

import { canonicalProviderId, canonicalUniqueProviders, getProvider, resolveProviderMonthlyCost } from '@/lib/tmdb/providers';
import { resolveEffectiveMonthlyCost, type CampaignCostSettings } from '@/lib/advisor/effectiveCost';

export interface SwedishBundle {
  /** Stable slug, e.g. 'telia-streaming-mest'. */
  id: string;
  /** Display name, e.g. 'Telia Streaming Mest'. */
  name: string;
  /** Vendor, e.g. 'Telia'. */
  vendor: string;
  /** ORDINARY monthly price (never an intro/campaign rate — header rule 1). */
  monthlyKr: number;
  /** Canonical TMDB provider ids the bundle includes. */
  includedProviderIds: number[];
  /**
   * Tier id (per providers.ts `tiers[]`) the bundle grants per provider, keyed by
   * canonical id. An OMITTED key means the provider's untiered/base offering
   * (defaultMonthlyCost) — deliberately distinct from a PRESENT-but-unknown tier
   * id (an orphan: catalog renamed/removed it), which fail-safes to "not
   * comparable" (the provider is skipped from replaced AND downgrade — a data
   * bug must never fabricate a saving).
   */
  includedTiers?: Record<number, string>;
  /** ISO date (YYYY-MM-DD) the price, contents AND TIER MIX were last hand-verified
   *  (the 180-day staleness bar covers all three — a bundle silently swapping a
   *  service's tier is exactly what the flag exists to catch). */
  verifiedDate: string;
  /** Optional signup/marketing URL (for the eventual UI + BIN-173 affiliate wrap). */
  url?: string;
}

/** A bundle that would save the user money versus their current à-la-carte set. */
export interface BundleSuggestion {
  bundle: SwedishBundle;
  /** Canonical ids of the user's PAID owned services this bundle would replace (always ≥2). */
  replacedProviderIds: number[];
  replacedNames: string[];
  /** What the user pays à-la-carte for exactly those replaced services, per month. */
  currentKr: number;
  /** The bundle's ordinary monthly price (mirror of bundle.monthlyKr). */
  bundleKr: number;
  /**
   * currentKr − bundleKr (always > 0 for a returned suggestion). Computed over the
   * REPLACED set ONLY — bonus services are qualitative and are NEVER folded in, so
   * this headline number can't be inflated by "extra stuff you'd also get".
   */
  savingKr: number;
  /** Bundle services the user does NOT already own — extra value, never priced into savingKr. */
  bonusProviderIds: number[];
  bonusNames: string[];
  /**
   * Owned services the bundle carries at a LOWER tier than the user's CHOSEN
   * tier (compared catalog-price-vs-catalog-price, campaign-immune — only set
   * when the user has an explicit tier, so the claim is always supported).
   * Qualitative context only ("Max ingår men i lägre nivå") — NEVER counted
   * toward the ≥2 replaced gate, currentKr, or savingKr (BIN-433, role #28).
   */
  downgradeProviderIds: number[];
  downgradeNames: string[];
  /**
   * True when the bundle's verifiedDate is older than the staleness threshold at
   * `now`. A real-money recommendation that went unverified for months must say so —
   * the UI MUST surface this ("priser verifierade [datum] — kan vara inaktuella").
   */
  stale: boolean;
}

/** How many days a hand-curated bundle price is trusted before it's flagged stale. */
export const BUNDLE_STALE_DAYS = 180;

/**
 * True when a bundle verified at `verifiedDate` is older than `maxAgeDays` at `now`.
 * A malformed / unparseable date is treated as STALE — fail-safe, because an
 * unverifiable price is exactly what this flag must never hide. Pure.
 */
export function isBundleStale(verifiedDate: string, now: Date, maxAgeDays = BUNDLE_STALE_DAYS): boolean {
  const verified = new Date(verifiedDate).getTime();
  if (Number.isNaN(verified)) return true;
  const ageDays = (now.getTime() - verified) / 86_400_000;
  return ageDays > maxAgeDays;
}

// Canonicalise + de-duplicate + drop uncatalogued ids ONCE per bundle. An alias
// pair (e.g. TV4 Play 489/1944) listed twice can't double-count replaced services;
// a phantom id not in SWEDISH_PROVIDERS is unpriceable (would corrupt currentKr) and
// unnameable (garbage bonus label), so it's dropped — mirrors listOptimizer's subsOf.
function normalizeIncluded(ids: number[]): number[] {
  return [...new Set(ids.map(canonicalProviderId).filter((id) => getProvider(id) !== undefined))];
}

// Canonicalise an includedTiers map's keys (canonical-keyed entry wins over an
// alias-keyed one) so a fixture keyed by an alias id still resolves.
function canonicalTierMap(tiers: Record<number, string> | undefined): Map<number, string> {
  const out = new Map<number, string>();
  if (!tiers) return out;
  for (const [k, v] of Object.entries(tiers)) {
    const raw = Number(k);
    const canon = canonicalProviderId(raw);
    if (raw === canon || !out.has(canon)) out.set(canon, v);
  }
  return out;
}

/**
 * The live catalog price of the tier a bundle grants for `id` (BIN-433):
 *  - key OMITTED from includedTiers → the provider's untiered/base offering
 *    (defaultMonthlyCost) — Prime's case;
 *  - key PRESENT and the tier exists → that tier's CURRENT catalog cost (live by
 *    design: when Netflix reprices, the honest comparison moves with it — do NOT
 *    "fix" this into a frozen snapshot, role #28 warns it would reintroduce the
 *    staleness bug resolveEffectiveMonthlyCost exists to remove);
 *  - key PRESENT but the tier id is unknown (orphan: the price agent renamed or
 *    removed it) → null = NOT COMPARABLE. Fail-safe: the provider is skipped from
 *    replaced AND downgrade — a seed-data bug must never fabricate a saving.
 */
function bundleTierPriceOf(id: number, tiers: Map<number, string>): number | null {
  const provider = getProvider(id);
  if (!provider) return null;
  const tierId = tiers.get(id);
  if (tierId === undefined) {
    // Ett UTELÄMNAT tier-key betyder basutbudet — men BARA för otierade tjänster
    // (Prime). För en TIERAD tjänst är utelämnandet ett kurerings-fel: att falla
    // tillbaka till defaultMonthlyCost (= standardnivåns pris) skulle sälja en
    // ad-nivå som ad-fri (high-review 2026-07-07). Fail-safe: not comparable.
    // Seed-kanarien i testerna gör felet högljutt redan vid kurering.
    if (provider.tiers && provider.tiers.length > 0) return null;
    return provider.defaultMonthlyCost ?? null;
  }
  const tier = provider.tiers?.find((t) => t.id === tierId);
  return tier ? tier.cost : null;
}

/** Shared display-name mapping for replaced/bonus/downgrade lists. */
function namesOf(ids: readonly number[]): string[] {
  return ids.map((id) => getProvider(id)?.name ?? `Tjänst ${id}`);
}

// Verified Swedish bundles — live-verifierat 2026-07-07 i riktig webbläsare
// (BIN-429): https://www.telia.se/tv/streaming + /streaming-mest ("Visa innehåll"
// per paket, tier-nivåerna ordagrant därifrån). ORDINARIE priser — 3-månaders-
// kampanjen (199/249/299) är IGNORERAD per regel 1. Nivåer mot vår katalog:
// Netflix "Standard" (utan reklam) = 'standard'; HBO Max "Basic med reklam" =
// 'ads'; Disney+ "Standard med reklam" = 'ads'; Amazon Prime "med reklam" =
// Primes otierade SE-basutbud (69 kr — reklamfinansierat sedan 2024; ett
// reklamfritt tillägg användaren betalar för landar som custom cost > 69 och
// klassas då ärligt som downgrade); TV4 "Play Plus" = 'plus' (Telias rad
// disclaimar reklam ENDAST på livesändningar/tv-kanaler — TV4:s standardcaveat
// på den reklamfria Plus-nivån); Viaplay "Film & serier" ("Ingen reklam") =
// 'standard'. Kontroll: Mer 327 kr à la carte vs 269 = 58 kr — matchar Telias
// egen "du sparar 58 kr/mån"-uppgift exakt.
const RAW_SWEDISH_BUNDLES: SwedishBundle[] = [
  {
    id: 'telia-streaming-mer',
    name: 'Telia Streaming Mer',
    vendor: 'Telia',
    monthlyKr: 269,
    includedProviderIds: [8, 384, 337],
    includedTiers: { 8: 'standard', 384: 'ads', 337: 'ads' },
    verifiedDate: '2026-07-07',
    url: 'https://www.telia.se/tv/streaming/streaming-mer',
  },
  {
    id: 'telia-streaming-maxad',
    name: 'Telia Streaming Maxad',
    vendor: 'Telia',
    monthlyKr: 319,
    includedProviderIds: [8, 384, 337, 119],
    includedTiers: { 8: 'standard', 384: 'ads', 337: 'ads' }, // Prime (119) otierad → bas
    verifiedDate: '2026-07-07',
    url: 'https://www.telia.se/tv/streaming/streaming-maxad',
  },
  {
    id: 'telia-streaming-mest',
    name: 'Telia Streaming Mest',
    vendor: 'Telia',
    monthlyKr: 499,
    includedProviderIds: [8, 384, 337, 119, 489, 76],
    includedTiers: { 8: 'standard', 384: 'ads', 337: 'ads', 489: 'plus', 76: 'standard' },
    verifiedDate: '2026-07-07',
    url: 'https://www.telia.se/tv/streaming/streaming-mest',
  },
];

/** Verified Swedish bundle catalogue (normalised at module load). */
export const SWEDISH_BUNDLES: SwedishBundle[] = RAW_SWEDISH_BUNDLES.map((b) => ({
  ...b,
  includedProviderIds: normalizeIncluded(b.includedProviderIds),
}));

/**
 * Bundles that would save this user money versus paying à-la-carte for the services
 * they already own. A suggestion is returned ONLY when the bundle would replace ≥2 of
 * the user's PAID services (effective cost > 0 at `now`) AND the net saving is strictly
 * positive — a single-service swap is a downgrade decision, not bundle arbitrage, and a
 * break-even-or-worse "saving" must never surface.
 *
 * `now` is REQUIRED and injected (never defaulted): this is a real-money surface, so
 * campaign resolution (a lapsed promo auto-reverting to the ordinary price) must be
 * deterministic and testable against expiry edges — matching resolveEffectiveMonthlyCost.
 *
 * Returns MUTUALLY-EXCLUSIVE alternatives, best saving first: a user can buy only one
 * bundle, so a consumer must NOT sum these as stacked savings. Overlapping bundles are
 * each returned independently; picking between them is the UI's/user's call.
 */
export function detectBundleArbitrage(
  ownedProviderIds: number[],
  user: CampaignCostSettings,
  bundles: readonly SwedishBundle[],
  now: Date,
): BundleSuggestion[] {
  const owned = new Set(canonicalUniqueProviders(ownedProviderIds));
  const suggestions: BundleSuggestion[] = [];

  for (const bundle of bundles) {
    // Idempotent for the pre-normalised real table; the real normaliser for raw fixtures.
    const included = normalizeIncluded(bundle.includedProviderIds);
    const tiers = canonicalTierMap(bundle.includedTiers);

    const replaced: number[] = [];
    const downgrades: number[] = [];
    let currentKr = 0;
    for (const id of included) {
      if (!owned.has(id)) continue;
      const effectiveCost = resolveEffectiveMonthlyCost(id, user, now);
      // Unknown cost (null) is NEVER coerced to 0 before any comparison — 0 would
      // fabricate a like-for-like "win" for a service Binge has no price for (role
      // #28 must-have). Unknown, free (SVT), ads (Pluto), and user-zeroed all skip
      // BOTH buckets: not a paid replacement.
      if (effectiveCost == null || effectiveCost <= 0) continue;
      const tierPrice = bundleTierPriceOf(id, tiers);
      if (tierPrice == null) continue; // orphan/omitted-tiered/unpriceable → not comparable (fail-safe)

      // Classification compares LEVEL, never the campaign/custom price (high-review
      // 2026-07-07: an active promo below the bundle tier's price otherwise masks a
      // hidden ad-tier downgrade as like-for-like):
      //  - the user HAS a chosen tier → compare the two tiers' live CATALOG prices
      //    (campaign-immune). A pricier chosen tier → an honest, SUPPORTED
      //    "ingår men i lägre nivå" downgrade.
      //  - NO chosen tier (custom/default) → their ordinary price (never campaign)
      //    as proxy. A HIGHER custom price says nothing about tier level, so it is
      //    NOT COMPARABLE — skipped from both buckets: never an unsupported
      //    downgrade label, never a fabricated saving either way.
      // currentKr always uses the EFFECTIVE cost (what they'd actually stop paying
      // today) — an active promo honestly shrinks the claimed saving.
      const chosenTierId = user.providerTiers?.[id];
      const chosenTier = chosenTierId
        ? getProvider(id)?.tiers?.find((t) => t.id === chosenTierId)
        : undefined;
      if (chosenTier) {
        if (chosenTier.cost <= tierPrice) {
          replaced.push(id);
          currentKr += effectiveCost;
        } else {
          downgrades.push(id);
        }
      } else {
        const ordinary = resolveProviderMonthlyCost(id, user);
        if (ordinary != null && ordinary <= tierPrice) {
          replaced.push(id);
          currentKr += effectiveCost;
        }
        // ordinary > tierPrice (grandfathered custom etc.) → not comparable: skip.
      }
    }
    if (replaced.length < 2) continue; // gate counts LIKE-FOR-LIKE replacements only
    const savingKr = currentKr - bundle.monthlyKr;
    if (savingKr <= 0) continue; // break-even-or-worse is never a "saving"

    const bonus = included.filter((id) => !owned.has(id));
    suggestions.push({
      bundle,
      replacedProviderIds: replaced,
      replacedNames: namesOf(replaced),
      currentKr,
      bundleKr: bundle.monthlyKr,
      savingKr,
      bonusProviderIds: bonus,
      bonusNames: namesOf(bonus),
      downgradeProviderIds: downgrades,
      downgradeNames: namesOf(downgrades),
      stale: isBundleStale(bundle.verifiedDate, now),
    });
  }

  suggestions.sort((a, b) => b.savingKr - a.savingKr);
  return suggestions;
}
