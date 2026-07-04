// BIN-183 — "Bundle arbitrage": detect when a user's separately-paid streaming
// services would be cheaper bought as a Swedish telecom/streamer BUNDLE (e.g.
// "dina 3 lösa tjänster för 760 kr finns i Telia Streaming Mest för 499 → spara
// 261 kr/mån"). Pure + client-side over the user's persisted cost settings — no
// TMDB calls. The runtime cousin of listOptimizer/spendSnapshot: same honesty
// bar (every kr is a subscription cost we actually know) and the same
// canonical + campaign-aware cost plumbing (resolveEffectiveMonthlyCost).
//
// This is a REAL-MONEY recommendation surface, so the seed-data rules are strict
// (role #28 stakeholder review, BIN-183):
//   1. SWEDISH_BUNDLES prices are the ORDINARY standing rate, never an intro /
//      campaign teaser — the same bar providers.ts holds for defaultMonthlyCost.
//      A bundle whose only known price is a temporary promo does NOT go in.
//   2. A seeded bundle's included tiers must be AT LEAST the ad-free standard tier
//      of each service — else the "saving" is partly a quality downgrade (ad-tier
//      substitution) and the comparison is dishonest. Curate at that bar.
//   3. Seed only what can be live-verified (dated + sourced), exactly like the
//      price comments in providers.ts. SWEDISH_BUNDLES therefore ships EMPTY until
//      that verification is done — the AFFILIATE_PROGRAMS precedent — with the
//      engine fully proven via fixture bundles in bundleArbitrage.test.ts. The
//      curation is TRACKED in BIN-429 (browser verification), never a silent gap;
//      a test fails loudly if a seeded bundle is ever already stale.
//
// The advisor UI that surfaces these is a separate Tier-B follow-up (BIN-430); the
// engine ships dormant (no consumer yet), like applyAffiliate + empty
// AFFILIATE_PROGRAMS in providers.ts.

import { canonicalProviderId, canonicalUniqueProviders, getProvider } from '@/lib/tmdb/providers';
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
  /** Canonical TMDB provider ids the bundle includes (ad-free standard tier ≥ — rule 2). */
  includedProviderIds: number[];
  /** ISO date (YYYY-MM-DD) the price + contents were last hand-verified. */
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

// Seed ships EMPTY (header rule 3) — the engine is proven via fixtures. Populated,
// verified data is curated in BIN-429. Each raw entry is normalised at module load
// so the real table can never carry an alias-double or a phantom id.
const RAW_SWEDISH_BUNDLES: SwedishBundle[] = [];

/** Verified Swedish bundle catalogue (normalised at module load). Empty until BIN-429. */
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

    const replaced: number[] = [];
    let currentKr = 0;
    for (const id of included) {
      if (!owned.has(id)) continue;
      // Free (SVT), ads (Pluto TV), or a user-zeroed custom cost → 0: not a real paid
      // service this bundle "replaces". The effectiveCost > 0 gate handles all three;
      // no separate isFree/isAds check is needed here.
      const cost = resolveEffectiveMonthlyCost(id, user, now) ?? 0;
      if (cost <= 0) continue;
      replaced.push(id);
      currentKr += cost;
    }
    if (replaced.length < 2) continue; // a genuine bundle, not a single-service downgrade
    const savingKr = currentKr - bundle.monthlyKr;
    if (savingKr <= 0) continue; // break-even-or-worse is never a "saving"

    const bonus = included.filter((id) => !owned.has(id));
    suggestions.push({
      bundle,
      replacedProviderIds: replaced,
      replacedNames: replaced.map((id) => getProvider(id)?.name ?? `Tjänst ${id}`),
      currentKr,
      bundleKr: bundle.monthlyKr,
      savingKr,
      bonusProviderIds: bonus,
      bonusNames: bonus.map((id) => getProvider(id)?.name ?? `Tjänst ${id}`),
      stale: isBundleStale(bundle.verifiedDate, now),
    });
  }

  suggestions.sort((a, b) => b.savingKr - a.savingKr);
  return suggestions;
}
