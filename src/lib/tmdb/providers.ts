export interface ProviderTier {
  id: string;
  name: string;
  cost: number;
}

export interface SwedishProvider {
  id: number;
  name: string;
  shortName: string;
  color: string;
  type: 'flatrate' | 'rent' | 'buy';
  defaultMonthlyCost?: number;
  tiers?: ProviderTier[];
  // TMDB listar ibland samma tjänst under flera provider_ids (t.ex. en
  // "flatrate"-post och en separat "ads"-post med olika id). Alla id:n här
  // mappas till samma SwedishProvider via getProvider().
  aliases?: number[];
  // Public service / gratis-tjänster. Används för att undanta från
  // pausa/avsluta-rekommendationer (alla i Sverige har redan SVT Play).
  isFree?: boolean;
  // Reklamfinansierad AVOD (Pluto TV, Plex, freevee etc). När en användare
  // inte har någon ads-tjänst filtrerar advisor bort ads-providers från
  // förslags-bucketen — annars rankas irrelevanta reklam-tjänster upp som
  // "alternativ" trots att användaren inte använder dem.
  isAds?: boolean;
}

export const SWEDISH_PROVIDERS: SwedishProvider[] = [
  {
    id: 8, name: 'Netflix', shortName: 'Netflix', color: '#E50914', type: 'flatrate', defaultMonthlyCost: 149,
    tiers: [
      { id: 'basic', name: 'Basic', cost: 109 },
      { id: 'standard', name: 'Standard', cost: 149 },
      { id: 'premium', name: 'Premium', cost: 199 },
    ],
  },
  { id: 119, name: 'Amazon Prime Video', shortName: 'Prime', color: '#00A8E1', type: 'flatrate', defaultMonthlyCost: 69 },
  {
    id: 337, name: 'Disney+', shortName: 'Disney+', color: '#0063E5', type: 'flatrate', defaultMonthlyCost: 109,
    tiers: [
      { id: 'ads', name: 'Standard med reklam', cost: 69 },
      { id: 'standard', name: 'Standard', cost: 109 },
      { id: 'premium', name: 'Premium', cost: 159 },
    ],
  },
  {
    id: 384, name: 'HBO Max', shortName: 'HBO', color: '#7B2FBE', type: 'flatrate', defaultMonthlyCost: 149,
    tiers: [
      { id: 'ads', name: 'Basic med reklam', cost: 89 },
      { id: 'standard', name: 'Standard', cost: 149 },
      { id: 'premium', name: 'Premium', cost: 189 },
    ],
  },
  {
    id: 76, name: 'Viaplay', shortName: 'Viaplay', color: '#FF6B00', type: 'flatrate', defaultMonthlyCost: 169,
    tiers: [
      { id: 'reklam', name: 'Film & Serier med reklam', cost: 79 },
      { id: 'standard', name: 'Film & Serier', cost: 169 },
      { id: 'medium', name: 'Medium (inkl. sport)', cost: 399 },
      { id: 'total', name: 'Total (all sport)', cost: 699 },
    ],
  },
  { id: 520, name: 'SVT Play', shortName: 'SVT', color: '#0F79AF', type: 'flatrate', defaultMonthlyCost: 0, isFree: true },
  {
    id: 489, name: 'TV4 Play', shortName: 'TV4', color: '#E2001A', type: 'flatrate', defaultMonthlyCost: 169,
    aliases: [1944],
    tiers: [
      { id: 'plus-ads', name: 'Plus med reklam', cost: 69 },
      { id: 'plus', name: 'Plus utan reklam', cost: 169 },
      { id: 'sport', name: 'Sport Total utan reklam', cost: 699 },
    ],
  },
  { id: 350, name: 'Apple TV+', shortName: 'Apple', color: '#555555', type: 'flatrate', defaultMonthlyCost: 119 },
  { id: 531, name: 'Paramount+', shortName: 'P+', color: '#0064FF', type: 'flatrate', defaultMonthlyCost: 99 },
  {
    id: 510, name: 'Discovery+', shortName: 'Disc+', color: '#1E3264', type: 'flatrate', defaultMonthlyCost: 89,
    tiers: [
      { id: 'entry', name: 'Entry (1 enhet, reklam)', cost: 49 },
      { id: 'ads', name: 'Med reklam (Full HD)', cost: 89 },
      { id: 'premium', name: 'Premium (4K)', cost: 189 },
      { id: 'sport', name: 'Sport Premium', cost: 349 },
    ],
  },
  {
    id: 1899, name: 'Max', shortName: 'Max', color: '#002BE7', type: 'flatrate', defaultMonthlyCost: 149,
    tiers: [
      { id: 'ads', name: 'Basic med reklam', cost: 89 },
      { id: 'standard', name: 'Standard', cost: 149 },
      { id: 'premium', name: 'Premium', cost: 189 },
    ],
  },
  {
    id: 323, name: 'Crunchyroll', shortName: 'CR', color: '#F47521', type: 'flatrate', defaultMonthlyCost: 89,
    tiers: [
      { id: 'fan', name: 'Fan', cost: 89 },
      { id: 'megafan', name: 'Mega Fan', cost: 119 },
    ],
  },
  {
    id: 431, name: 'SkyShowtime', shortName: 'Sky', color: '#0D1D40', type: 'flatrate', defaultMonthlyCost: 99,
    tiers: [
      { id: 'ads', name: 'Standard med annonser', cost: 59 },
      { id: 'standard', name: 'Standard', cost: 99 },
      { id: 'premium', name: 'Premium', cost: 149 },
    ],
  },
  {
    id: 335, name: 'YouTube Premium', shortName: 'YT', color: '#FF0000', type: 'flatrate', defaultMonthlyCost: 149,
    tiers: [
      { id: 'student', name: 'Student', cost: 95 },
      { id: 'solo', name: 'Enskild', cost: 149 },
      { id: 'family', name: 'Familj', cost: 279 },
    ],
  },
  { id: 521, name: 'Tele2 Play', shortName: 'Tele2', color: '#00A0D6', type: 'flatrate', defaultMonthlyCost: 99 },
  { id: 578, name: 'TriArt Play', shortName: 'TriArt', color: '#222222', type: 'flatrate', defaultMonthlyCost: 79 },
  { id: 35, name: 'Rakuten TV', shortName: 'Rakuten', color: '#BF0000', type: 'rent' },
  { id: 3, name: 'Google Play Movies', shortName: 'Google', color: '#4285F4', type: 'rent' },
  { id: 2, name: 'Apple TV', shortName: 'Apple', color: '#555555', type: 'rent' },
];

export const PROVIDER_MAP: Map<number, SwedishProvider> = (() => {
  const m = new Map<number, SwedishProvider>();
  for (const p of SWEDISH_PROVIDERS) {
    m.set(p.id, p);
    for (const alias of p.aliases ?? []) m.set(alias, p);
  }
  return m;
})();

export function getProvider(id: number): SwedishProvider | undefined {
  return PROVIDER_MAP.get(id);
}

// Returnerar den kanoniska provider_id för alla varianter (t.ex. både 489
// och 1944 → 489). Används när vi sparar providers på en watchlist-item så
// samma tjänst inte dyker upp flera gånger.
export function canonicalProviderId(id: number): number {
  return PROVIDER_MAP.get(id)?.id ?? id;
}

export function getProviderColor(id: number): string {
  return PROVIDER_MAP.get(id)?.color ?? '#888';
}
