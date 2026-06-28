export interface ProviderTier {
  id: string;
  name: string;
  cost: number;
  // 'sport' = a sport/bundle upsell tier. Excluded from the cheapest-path price
  // (cheapestEntertainmentTier) — these grant catalog access but are never the
  // cheapest way to watch a film/series, and the guard keeps a future mis-priced
  // sport tier from ever surfacing as "billigast". (BIN-322)
  kind?: 'sport';
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
    id: 384, name: 'Max', shortName: 'HBO', color: '#7B2FBE', type: 'flatrate', defaultMonthlyCost: 149,
    // 1899 = legacy HBO Max-id. 1825 = "HBO Max Amazon Channel"
    // (live-verifierat SE-id 2026-06-10) — samma tjänst via Prime Video.
    aliases: [1899, 1825],
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
      { id: 'medium', name: 'Medium (inkl. sport)', cost: 399, kind: 'sport' },
      { id: 'total', name: 'Total (all sport)', cost: 699, kind: 'sport' },
    ],
  },
  // 493 = TMDB:s nuvarande SE-id för SVT (katalog-endpoint 2026-06-20); 520 var
  // det gamla "SVT Play"-id:t. Behåll 520 som primär, aliasa 493 (BIN-64).
  { id: 520, name: 'SVT Play', shortName: 'SVT', color: '#0F79AF', type: 'flatrate', defaultMonthlyCost: 0, isFree: true, aliases: [493] },
  {
    // shortName avsiktligt = name: advisor-ytor blandade "TV4" (shortName i
    // timeline-lanes + Hem-widget) med "TV4 Play" (providerName i råd-texterna).
    // Ett namn överallt (A3, QA-audit 2026-06-09).
    id: 489, name: 'TV4 Play', shortName: 'TV4 Play', color: '#E2001A', type: 'flatrate', defaultMonthlyCost: 169,
    // 1944 = TMDB:s nuvarande primär-id för TV4 Play. 1759 = retirerade C More
    // (uppgick i TV4 Play); finns inte längre i TMDB:s live-katalog men gammal
    // sparad provider-data kan innehålla det → canonicalisera till TV4 Play.
    aliases: [1944, 1759],
    tiers: [
      { id: 'plus-ads', name: 'Plus med reklam', cost: 69 },
      { id: 'plus', name: 'Plus utan reklam', cost: 169 },
      { id: 'sport', name: 'Sport Total utan reklam', cost: 699, kind: 'sport' },
    ],
  },
  {
    id: 350, name: 'Apple TV+', shortName: 'Apple', color: '#555555', type: 'flatrate', defaultMonthlyCost: 119,
    // 2243 = "Apple TV Amazon Channel" (live-verifierat SE-id 2026-06-10).
    aliases: [2243],
  },
  { id: 531, name: 'Paramount+', shortName: 'P+', color: '#0064FF', type: 'flatrate', defaultMonthlyCost: 99 },
  {
    id: 510, name: 'Discovery+', shortName: 'Disc+', color: '#1E3264', type: 'flatrate', defaultMonthlyCost: 89,
    tiers: [
      { id: 'entry', name: 'Entry (1 enhet, reklam)', cost: 49 },
      { id: 'ads', name: 'Med reklam (Full HD)', cost: 89 },
      { id: 'premium', name: 'Premium (4K)', cost: 189 },
      { id: 'sport', name: 'Sport Premium', cost: 349, kind: 'sport' },
    ],
  },
  {
    id: 323, name: 'Crunchyroll', shortName: 'CR', color: '#F47521', type: 'flatrate', defaultMonthlyCost: 89,
    // 1968 = "Crunchyroll Amazon Channel" (live-verifierat SE-id 2026-06-10).
    // 283 = TMDB:s nuvarande bas-id för Crunchyroll på titel-nivå (live-verifierat
    // 2026-06-20 via /tv/37854 → SE flatrate 283). Behåll 323 som primär så
    // redan sparad canonical-data (323) inte splittras; aliasa 283 hit (BIN-64).
    aliases: [1968, 283],
    tiers: [
      { id: 'fan', name: 'Fan', cost: 89 },
      { id: 'megafan', name: 'Mega Fan', cost: 119 },
    ],
  },
  {
    id: 431, name: 'SkyShowtime', shortName: 'Sky', color: '#0D1D40', type: 'flatrate', defaultMonthlyCost: 99,
    // 1773 = TMDB:s nuvarande SE-id för SkyShowtime (katalog-endpoint 2026-06-20). (BIN-64)
    aliases: [1773],
    tiers: [
      { id: 'ads', name: 'Standard med annonser', cost: 59 },
      { id: 'standard', name: 'Standard', cost: 99 },
      { id: 'premium', name: 'Premium', cost: 149 },
    ],
  },
  {
    id: 335, name: 'YouTube Premium', shortName: 'YT', color: '#FF0000', type: 'flatrate', defaultMonthlyCost: 149,
    // 188 = TMDB:s nuvarande SE-id för YouTube Premium (katalog-endpoint 2026-06-20). (BIN-64)
    aliases: [188],
    tiers: [
      { id: 'student', name: 'Student', cost: 95 },
      { id: 'solo', name: 'Enskild', cost: 149 },
      { id: 'family', name: 'Familj', cost: 279 },
    ],
  },
  // 497 / 517 = TMDB:s nuvarande SE-id:n för Tele2 Play / TriArt Play
  // (katalog-endpoint 2026-06-20); 521 / 578 var de gamla. Aliasa de nya (BIN-64).
  { id: 521, name: 'Tele2 Play', shortName: 'Tele2', color: '#00A0D6', type: 'flatrate', defaultMonthlyCost: 99, aliases: [497] },
  { id: 578, name: 'TriArt Play', shortName: 'TriArt', color: '#222222', type: 'flatrate', defaultMonthlyCost: 79, aliases: [517] },
  { id: 35, name: 'Rakuten TV', shortName: 'Rakuten', color: '#BF0000', type: 'rent' },
  { id: 3, name: 'Google Play Movies', shortName: 'Google', color: '#4285F4', type: 'rent' },
  { id: 2, name: 'Apple TV', shortName: 'Apple', color: '#555555', type: 'rent' },
  // SF Anytime — stor svensk hyr/köp-tjänst (TVOD). TMDB SE-id 426 (live-verifierat
  // 2026-06-20). Tidigare saknad → titlar som bara finns där såg "otillgängliga" ut. (BIN-64)
  { id: 426, name: 'SF Anytime', shortName: 'SF Anytime', color: '#E4002B', type: 'rent' },
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

// The cheapest tier a viewer can actually use to watch general-catalog content,
// for the "billigaste vägen" verdict (BIN-322). Excludes sport/bundle tiers
// (kind: 'sport'). Returns the chosen tier (for an honest "(Basic / med reklam)"
// label) and its cost; falls back to defaultMonthlyCost when the provider has no
// tier breakdown. Cost is Infinity for an unknown provider so it sorts last.
export function cheapestEntertainmentTier(
  id: number,
): { cost: number; tier: ProviderTier | null } {
  const p = getProvider(id);
  if (!p) return { cost: Number.POSITIVE_INFINITY, tier: null };
  const usable = (p.tiers ?? []).filter(t => t.kind !== 'sport');
  if (usable.length === 0) {
    return { cost: p.defaultMonthlyCost ?? Number.POSITIVE_INFINITY, tier: null };
  }
  const cheapest = usable.reduce((a, b) => (b.cost < a.cost ? b : a));
  return { cost: cheapest.cost, tier: cheapest };
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

// BIN-90: har titeln någon GRATIS-tjänst bland sina (kanoniska) provider-ids?
// Används för en "Gratis"-markering på kort, där bara den mergade provider-listan
// finns (titel-sidor har free/ads-kategorierna direkt från TMDB). Fångar
// katalogens isFree-tjänster (t.ex. SVT Play); ren AVOD/ads-only syns på titel-sidan.
export function hasFreeProvider(ids: number[]): boolean {
  return ids.some(id => PROVIDER_MAP.get(id)?.isFree === true);
}

// BIN-173 — affiliate-tag the rent/buy deeplinks Binge already renders, so the
// outbound clicks we already drive (across 25k SEO title pages) earn commission
// instead of leaking. Table-driven: each entry is keyed by the *canonical*
// provider id and rewrites the bare MOTN deeplink into the network's tagged URL.
//
// AFFILIATE_PROGRAMS is intentionally EMPTY in production until the affiliate
// accounts exist (Viaplay via Adtraction; Apple/Amazon/SkyShowtime Nordic
// programs — a manual signup step). Until then affiliateWrap() is a no-op
// passthrough, so links are unchanged and nothing can break. When an account
// lands, add one entry here; the render sites already call affiliateWrap().
export type AffiliateProgram = (url: string) => string;

// applyAffiliate is the pure, injectable core (testable with a fake table);
// affiliateWrap binds it to the live table. canonicalProviderId routes aliases
// (e.g. TV4 Play 1944 → 489) to the same program.
export function applyAffiliate(
  programs: Record<number, AffiliateProgram>,
  providerId: number,
  url: string,
): string {
  const fn = programs[canonicalProviderId(providerId)];
  return fn ? fn(url) : url;
}

export const AFFILIATE_PROGRAMS: Record<number, AffiliateProgram> = {};

export function affiliateWrap(providerId: number, url: string): string {
  return applyAffiliate(AFFILIATE_PROGRAMS, providerId, url);
}

// BIN-175 — alla TMDB provider-ids (inkl. alias) för gratis public-service-
// tjänster (SVT Play; UR när det katalogiseras). Driver "Gratis just nu"-raden
// i rekommendationerna (discover with_watch_providers) — det kostnadsfria,
// skattefinansierade lagret floatas upp framför betaltjänster.
export const FREE_PUBLIC_PROVIDER_IDS: number[] = (() => {
  const ids: number[] = [];
  for (const p of SWEDISH_PROVIDERS) {
    if (p.isFree) ids.push(p.id, ...(p.aliases ?? []));
  }
  return ids;
})();

// TMDB listar Prime Video-kanaler som egna providers med namn-suffixet
// " Amazon Channel" (ibland plural). Kända varianter mappas via aliases ovan;
// suffixet är fallback för framtida variant-ids vi inte hunnit katalogisera.
const AMAZON_CHANNEL_SUFFIX = /\s+Amazon Channels?$/i;

// Dedupar en renderbar providerlista (flatrate/free/ads) på kanoniskt id så
// samma tjänst aldrig visas två gånger (X3/T1/SÖ2/M2, QA-audit 2026-06-09).
// Två mekanismer:
//   1. canonicalProviderId via alias-tabellen (kända variant-ids).
//   2. Namn-suffix-fallback: "X Amazon Channel" kollapsar mot basen "X" om
//      basen finns i SWEDISH_PROVIDERS eller i samma lista. Saknas basen helt
//      behålls varianten — då ÄR kanalen den enda tjänsten som har titeln.
// Bas-entryn (provider_id === kanoniskt id) vinner över varianten oavsett
// ordning i listan; i övrigt behålls första förekomsten och ordningen.
export function dedupeProvidersByCanonicalId<T extends { provider_id: number; provider_name: string }>(
  list: T[],
): T[] {
  // Lowercase-namn → kanonisk nyckel för entries i listan, så en okänd
  // variant kan hitta sin bas via namn-match.
  const keyByName = new Map<string, number>();
  for (const p of list) {
    const name = p.provider_name.trim().toLowerCase();
    if (!keyByName.has(name)) keyByName.set(name, canonicalProviderId(p.provider_id));
  }

  function resolveKey(p: T): number {
    const mapped = PROVIDER_MAP.get(p.provider_id);
    if (mapped) return mapped.id;
    if (AMAZON_CHANNEL_SUFFIX.test(p.provider_name)) {
      const base = p.provider_name.replace(AMAZON_CHANNEL_SUFFIX, '').trim().toLowerCase();
      const catalog = SWEDISH_PROVIDERS.find(sp => sp.name.toLowerCase() === base);
      if (catalog) return catalog.id;
      const inList = keyByName.get(base);
      if (inList !== undefined) return inList;
    }
    return p.provider_id;
  }

  const kept = new Map<number, T>();
  for (const p of list) {
    const key = resolveKey(p);
    const existing = kept.get(key);
    if (!existing) {
      kept.set(key, p);
    } else if (existing.provider_id !== key && p.provider_id === key) {
      // Varianten råkade komma först — byt till bas-entryn (behåller
      // first-seen-position eftersom Map bevarar insättningsordning).
      kept.set(key, p);
    }
  }
  return Array.from(kept.values());
}

// Plockar ut SE-streamingproviders från en TMDB-detalj (movie eller TV).
// Använder samma kategorier (flatrate + free + ads — inte rent/buy) och samma
// canonical-mapping som vi sparar på watchlist-items. Returnerar en
// dedupad lista av canonical provider_ids. Tom array betyder att TMDB inte
// listar någon SE-streamingtjänst för titeln.
export function extractSEProviders(detail: {
  'watch/providers'?: { results: { SE?: { flatrate?: { provider_id: number }[]; free?: { provider_id: number }[]; ads?: { provider_id: number }[] } } };
}): number[] {
  const se = detail['watch/providers']?.results?.SE;
  if (!se) return [];
  const raw = [
    ...(se.flatrate ?? []),
    ...(se.free ?? []),
    ...(se.ads ?? []),
  ].map(p => canonicalProviderId(p.provider_id));
  return Array.from(new Set(raw));
}
