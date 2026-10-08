// Gästens val i kalkylatorn (/streamingkostnad/) och startsidans demo, sparat i
// sessionStorage så att det följer med till inloggningen och introduktionens
// tjänststeg. Ingenting skickas till servern som gäst.
//
// EN nyckel, importerad av kalkylatorn, startsidan och OnboardingFlow — en andra
// stavning någonstans vore en tyst förlust av valet.
//
// Det som läses tillbaka valideras: det kommer ur besökarens egen webbläsare och
// kan vara gammalt (en nivå som katalogen tagit bort) eller handskrivet. Okända
// tjänster och nivåer släpps, resten behålls.

import { SWEDISH_PROVIDERS, getProvider, type SwedishProvider } from '@/lib/tmdb/providers';

export const GUEST_PROVIDERS_KEY = 'binge:guestProviders';

/** Kanoniskt tjänst-id → vald nivå, eller null för "Vet inte". */
export type GuestSelection = Record<number, string | null>;

/** En betald flatrate-tjänst med listpris — de som går att räkna på. */
export function isGuestPricedProvider(p: SwedishProvider): boolean {
  return p.type === 'flatrate' && !p.isFree && !p.isAds && (p.defaultMonthlyCost ?? 0) > 0;
}

/** Kalkylatorns rader, i katalogens ordning. */
export const GUEST_PRICED_PROVIDERS: SwedishProvider[] = SWEDISH_PROVIDERS.filter(isGuestPricedProvider);

/** Behåller bara kanoniska, betalda tjänster och nivåer som finns i katalogen. */
export function sanitizeGuestSelection(raw: unknown): GuestSelection {
  const out: GuestSelection = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(key)) continue;
    const id = Number(key);
    const provider = getProvider(id);
    if (!provider || provider.id !== id || !isGuestPricedProvider(provider)) continue;
    if (value === null) {
      out[id] = null;
    } else if (typeof value === 'string' && provider.tiers?.some(t => t.id === value)) {
      out[id] = value;
    }
  }
  return out;
}

export function loadGuestSelection(): GuestSelection {
  try {
    const raw = window.sessionStorage.getItem(GUEST_PROVIDERS_KEY);
    if (!raw) return {};
    return sanitizeGuestSelection(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveGuestSelection(selection: GuestSelection): void {
  try {
    const clean = sanitizeGuestSelection(selection);
    if (Object.keys(clean).length === 0) {
      window.sessionStorage.removeItem(GUEST_PROVIDERS_KEY);
    } else {
      window.sessionStorage.setItem(GUEST_PROVIDERS_KEY, JSON.stringify(clean));
    }
  } catch {
    // Privat läge / blockerad lagring: valet följer inte med, sidan fungerar ändå.
  }
}

export function clearGuestSelection(): void {
  try {
    window.sessionStorage.removeItem(GUEST_PROVIDERS_KEY);
  } catch {
    // Se saveGuestSelection.
  }
}
