import { canonicalProviderId, getProvider, resolveProviderMonthlyCost, type ProviderTier } from '@/lib/tmdb/providers';

// Viaplays paket med Apple TV (nivåer som slutar på "-appletv") innehåller Apple TV+.
// Den som också har Apple TV+ som egen tjänst betalar för samma sak dubbelt, så
// Apple TV+ räknas som 0 kr i alla summor (resolveEffectiveMonthlyCost) och Rådgivaren
// ber hen säga upp det hos Apple.

export const VIAPLAY_ID = 76;
export const APPLE_TV_PLUS_ID = 350;

const APPLE_TV_TIER_SUFFIX = '-appletv';

/** Användarens valda Viaplay-nivå om den innehåller Apple TV, annars null. */
export function viaplayAppleTvTier(user: { providerTiers?: Record<number, string> }): ProviderTier | null {
  const tierId = user.providerTiers?.[VIAPLAY_ID];
  if (!tierId || !tierId.endsWith(APPLE_TV_TIER_SUFFIX)) return null;
  return getProvider(VIAPLAY_ID)?.tiers?.find(t => t.id === tierId) ?? null;
}

/** Apple TV+ som ingår i Viaplay-paketet och därför inte kostar något extra. */
export function isAppleTvIncludedInViaplay(
  providerId: number,
  user: { providerTiers?: Record<number, string>; myProviders?: number[] },
): boolean {
  if (canonicalProviderId(providerId) !== APPLE_TV_PLUS_ID) return false;
  // Nivån ligger kvar i profilen när Viaplay tas bort ur listan, så Viaplay måste vara ägd.
  // Utan känd lista räknas Apple TV+ som vanligt: en kostnad ska aldrig försvinna av okunskap.
  // Apple TV+ måste också vara ägt: en tjänst man inte har kostar sitt katalogpris i förslagen.
  const owned = new Set((user.myProviders ?? []).map(canonicalProviderId));
  if (!owned.has(VIAPLAY_ID) || !owned.has(APPLE_TV_PLUS_ID)) return false;
  return viaplayAppleTvTier(user) != null;
}

export interface AppleTvOverlap {
  viaplayTierName: string;
  /** Vad användaren betalar för Apple TV+ separat: eget belopp, annars katalogens pris. */
  appleTvKr: number;
}

/** Ger överlappet när Apple TV+ är inlagd och ingår i användarens Viaplay-paket, annars null. */
export function appleTvOverlap(
  myProviders: number[],
  user: { providerTiers?: Record<number, string>; providerCosts?: Record<number, number> },
): AppleTvOverlap | null {
  if (!isAppleTvIncludedInViaplay(APPLE_TV_PLUS_ID, { ...user, myProviders })) return null;
  const tier = viaplayAppleTvTier(user);
  if (!tier) return null;
  const appleTvKr = resolveProviderMonthlyCost(APPLE_TV_PLUS_ID, user);
  if (appleTvKr == null || appleTvKr <= 0) return null;
  return { viaplayTierName: tier.name, appleTvKr };
}
