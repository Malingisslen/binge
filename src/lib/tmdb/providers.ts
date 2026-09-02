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
    // live-verifierat 2026-07-02 — https://help.netflix.com/en/node/24926 (SE-höjning ~2026-05-15, +20 kr rakt över, ordinarie ej kampanj)
    id: 8, name: 'Netflix', shortName: 'Netflix', color: '#E50914', type: 'flatrate', defaultMonthlyCost: 169,
    // 175 = "Netflix Kids", TMDB:s egen variantpost för samma abonnemang — inte en egen
    // tjänst. Utan aliaset renderas en titel TMDB märker med 175 som en okänd leverantör.
    // Id:t kommer ur BIN-1073:s svep av /watch/providers/movie?watch_region=SE 2026-09-02.
    // Samma endpoint omläst 2026-09-02: 175 svarar `provider_name: "Netflix Kids"`. Det är
    // en omläsning av TMDB mot TMDB — ingen korsverifiering mot extern källa, och den säger
    // inget om huruvida aliaset är rätt sammanslaget, bara att TMDB:s klassning står kvar.
    // Ett fel ALIAS viker tyst in vad 175 än verkligen är i Netflix identitet överallt
    // — märken, dedup, kostnadssummor. Kontrollera det före nästa aliastillägg. (BIN-1077)
    aliases: [175],
    tiers: [
      { id: 'basic', name: 'Basic', cost: 129 },
      { id: 'standard', name: 'Standard', cost: 169 },
      { id: 'premium', name: 'Premium', cost: 219 },
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
    // live-verifierat 2026-07-02 — https://viaplay.se — reklam = 99 ORDINARIE utan bindning
    // (79 var reklam + 6 mån bindning); total = 749 ordinarie reklamfritt (699 = Total med reklam) (BIN-406)
    // live-verifierat 2026-09-02 — https://viaplay.se — medium = 449 ordinarie, ingen kampanj
    // på den nivån (katalogen stod på 399) (BIN-1070)
    tiers: [
      { id: 'reklam', name: 'Film & Serier med reklam', cost: 99 },
      { id: 'standard', name: 'Film & Serier', cost: 169 },
      { id: 'medium', name: 'Medium (inkl. sport)', cost: 449, kind: 'sport' },
      { id: 'total', name: 'Total (all sport)', cost: 749, kind: 'sport' },
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
    // live-verifierat 2026-09-02 — https://tv4play.se/paket — TV4 säljer numera FEM paket.
    // De tre mellannivåerna saknades helt. De billigare
    // raderna på sidan är 12 mån bindning, inte ordinarie, och modelleras inte. Reklam-
    // varianterna av sportpaketen är MEDVETET utelämnade: katalogen har ingen reklam-variant
    // av någon sportnivå, och en sådan axel är Malins beslut, inte ett svep. (BIN-1072)
    tiers: [
      { id: 'plus-ads', name: 'Plus med reklam', cost: 69 },
      { id: 'plus', name: 'Plus utan reklam', cost: 169 },
      { id: 'sport-bas', name: 'Sport utan reklam', cost: 399, kind: 'sport' },
      { id: 'sport-fotboll', name: 'Sport Fotboll utan reklam', cost: 499, kind: 'sport' },
      { id: 'sport-hockey', name: 'Sport Hockey utan reklam', cost: 649, kind: 'sport' },
      { id: 'sport', name: 'Sport Total utan reklam', cost: 699, kind: 'sport' },
    ],
  },
  {
    id: 350, name: 'Apple TV+', shortName: 'Apple', color: '#555555', type: 'flatrate', defaultMonthlyCost: 119,
    // 2243 = "Apple TV Amazon Channel" (live-verifierat SE-id 2026-06-10).
    aliases: [2243],
  },
  {
    // live-verifierat 2026-07-02 — https://www.discoveryplus.com/se/sv (nivåstruktur omgjord till 3 nivåer; 'Premium (4K)'/'Entry' finns inte längre som egna SKU:er)
    id: 510, name: 'Discovery+', shortName: 'Disc+', color: '#1E3264', type: 'flatrate', defaultMonthlyCost: 109,
    tiers: [
      { id: 'ads', name: 'Underhållning (med reklam)', cost: 59 },
      { id: 'standard', name: 'Underhållning', cost: 109 },
      { id: 'sport', name: 'Underhållning + Sport', cost: 179, kind: 'sport' },
    ],
  },
  {
    // live-verifierat 2026-07-05 — https://www.crunchyroll.com/premium (SE, VAT-inkl.):
    // Fan 85 / Mega Fan 99. Var 89/119 (för högt); den påstådda 199 kr var fel — SE har
    // bara två nivåer och de ligger LÄGRE än katalogen tidigare visade (BIN-406).
    id: 323, name: 'Crunchyroll', shortName: 'CR', color: '#F47521', type: 'flatrate', defaultMonthlyCost: 85,
    // 1968 = "Crunchyroll Amazon Channel" (live-verifierat SE-id 2026-06-10).
    // 283 = TMDB:s nuvarande bas-id för Crunchyroll på titel-nivå (live-verifierat
    // 2026-06-20 via /tv/37854 → SE flatrate 283). Behåll 323 som primär så
    // redan sparad canonical-data (323) inte splittras; aliasa 283 hit (BIN-64).
    aliases: [1968, 283],
    tiers: [
      { id: 'fan', name: 'Fan', cost: 85 },
      { id: 'megafan', name: 'Mega Fan', cost: 99 },
    ],
  },
  {
    // live-verifierat 2026-07-02 — https://www.skyshowtime.com/se (höjning bekräftad feb 2026)
    id: 431, name: 'SkyShowtime', shortName: 'Sky', color: '#0D1D40', type: 'flatrate', defaultMonthlyCost: 109,
    // 1773 = TMDB:s nuvarande SE-id för SkyShowtime (katalog-endpoint 2026-06-20). (BIN-64)
    // 531 = nedlagda Paramount+ (SE-nedläggning 2022-10-01, uppgick i SkyShowtime — BIN-404);
    // aliasa hit så gammal sparad Paramount+-data + ev. TMDB-titlar mappar till efterträdaren.
    aliases: [1773, 531],
    tiers: [
      { id: 'ads', name: 'Standard med annonser', cost: 59 },
      { id: 'standard', name: 'Standard', cost: 109 },
      { id: 'premium', name: 'Premium', cost: 159 },
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
  // live-verifierat 2026-07-02 — https://www.tele2.se/tv — 99 kr var KAMPANJ (6 mån); ordinarie Streaming Flex = 199 (BIN-406)
  { id: 521, name: 'Tele2 Play', shortName: 'Tele2', color: '#00A0D6', type: 'flatrate', defaultMonthlyCost: 199, aliases: [497] },
  // Pluto TV (TMDB SE-id 300, live-verifierat 2026-07-02) — gratis reklamfinansierad AVOD;
  // ersatte Viafree i SE 2022 (Lyxfällan/Paradise Hotel m.m., 70+ kanaler). isAds driver
  // advisor-ads-bucketen; defaultMonthlyCost 0 → advisor ger 'free'-status (aldrig paus-
  // kandidat). Ligger MEDVETET inte i FREE_PUBLIC_PROVIDER_IDS (isFree) — det lagret är för
  // skattefinansierad public service (SVT), inte kommersiellt AVOD (BIN-410).
  { id: 300, name: 'Pluto TV', shortName: 'Pluto', color: '#FFE100', type: 'flatrate', defaultMonthlyCost: 0, isAds: true },
  // Plex — gratis reklamfinansierad AVOD, samma form som Pluto TV ovan: flatrate + kostnad 0
  // + isAds, vilket är det som gör att advisor bara föreslår den för den som redan använder
  // reklam-tjänster. `type: 'rent'` hade sett rimligt ut och tyst tagit den ur precis den
  // logiken. Id 538 ur BIN-1073:s SE-svep 2026-09-02; /watch/providers/movie?watch_region=SE
  // omläst 2026-09-02 svarar `provider_name: "Plex"`. TMDB mot TMDB, ingen extern källa.
  // (BIN-1077)
  { id: 538, name: 'Plex', shortName: 'Plex', color: '#E5A00D', type: 'flatrate', defaultMonthlyCost: 0, isAds: true },
  // live-verifierat 2026-07-02 — https://www.triartplay.se — INTE längre fri flatrate-streaming:
  // numera en hyr-tjänst med medlemsklubb ("Klubben" 49 kr/mån = en gratisfilm + hyrrabatter). (BIN-406)
  { id: 578, name: 'TriArt Play', shortName: 'TriArt', color: '#222222', type: 'rent', aliases: [517] },
  { id: 35, name: 'Rakuten TV', shortName: 'Rakuten', color: '#BF0000', type: 'rent' },
  { id: 3, name: 'Google Play Movies', shortName: 'Google', color: '#4285F4', type: 'rent' },
  { id: 2, name: 'Apple TV', shortName: 'Apple', color: '#555555', type: 'rent' },
  // SF Anytime — stor svensk hyr/köp-tjänst (TVOD). TMDB SE-id 426 (live-verifierat
  // 2026-06-20). Tidigare saknad → titlar som bara finns där såg "otillgängliga" ut. (BIN-64)
  { id: 426, name: 'SF Anytime', shortName: 'SF Anytime', color: '#E4002B', type: 'rent' },
  // Blockbuster — svensk hyr/köp-tjänst (Telenor). Samma lucka SF Anytime fyllde i BIN-64:
  // en titel som bara finns där ser "otillgänglig" ut. Som `rent` bär den ingen prisdata att
  // underhålla och räknas aldrig in i någon månadskostnad. Id 423 ur BIN-1073:s SE-svep
  // 2026-09-02; /watch/providers/movie?watch_region=SE omläst 2026-09-02 svarar
  // `provider_name: "Blockbuster"`. TMDB mot TMDB, ingen extern källa. (BIN-1077)
  { id: 423, name: 'Blockbuster', shortName: 'Blockbuster', color: '#003399', type: 'rent' },
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
  return cheapestEntertainmentTierFrom(p);
}

// Pure core of the above, split out so the sport-exclusion guard is independently
// falsifiable (BIN-353): with a synthetic provider whose CHEAPEST tier is sport,
// a test can prove this skips it — the id-based wrapper can't, since real sport
// tiers are always the most expensive (min would dodge them even without the
// filter). Same extract-then-test pattern used across the codebase.
export function cheapestEntertainmentTierFrom(
  p: SwedishProvider,
): { cost: number; tier: ProviderTier | null } {
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

// Canonicalise + de-duplicate a list of provider ids (BIN-409). A user's
// myProviders can hold a legacy alias id AND its canonical id at once (e.g. 531
// Paramount+ + 431 SkyShowtime after the merge, or 1759 C More + 489 TV4) — every
// cost-summing surface must map through this first, or the same service is counted
// twice. Order-preserving (first occurrence of each canonical id wins).
export function canonicalUniqueProviders(ids: number[]): number[] {
  return [...new Set(ids.map(canonicalProviderId))];
}

// The single source of truth for "what does THIS user pay per month for this
// provider" (BIN — automatisk prisuppdatering). Every personal-cost surface
// (Streamingrådgivaren, spend-snapshot, service-value, Settings-totalen,
// resumeProvider) resolves through here so they can never disagree.
//
// Resolution order — tier first, so a chosen tier tracks the LIVE catalog price
// instead of a value frozen at selection time:
//   1. A chosen tier that still exists in the catalog → its CURRENT `cost`
//      (this is the whole point: when the catalog price moves, the user follows).
//   2. A custom user-entered cost (providerCosts) — only ever set when NO tier is
//      chosen (the "Egen kostnad…" path), or as an orphan fallback below.
//   3. The catalog `defaultMonthlyCost`.
//
// A tier id that no longer exists (the monthly agent removed/renamed it — only
// ever via a human ticket) is an ORPHAN: we fall through to custom/default rather
// than returning null, so the user is never pinned to a broken lookup. Maps are
// keyed by the CANONICAL provider id (what updateProviderTier/setProviderCost
// write), so we canonicalise the lookup — an alias id resolves the same.
// Returns null only for an unknown provider or when no cost is known anywhere;
// callers that need a number use `?? 0`.
export function resolveProviderMonthlyCost(
  providerId: number,
  user: { providerTiers?: Record<number, string>; providerCosts?: Record<number, number> },
): number | null {
  const provider = getProvider(providerId);
  if (!provider) return null;
  const key = provider.id; // canonical — matches how the user's maps are keyed
  const tierId = user.providerTiers?.[key];
  if (tierId) {
    const tier = provider.tiers?.find(t => t.id === tierId);
    if (tier) return tier.cost; // live catalog price for the chosen tier
    // else: orphan tier id → fall through to custom/default
  }
  const custom = user.providerCosts?.[key];
  if (custom != null) return custom;
  return provider.defaultMonthlyCost ?? null;
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

// BIN-814 (2026-08-09): `extractSEProviders` lived here and returned the
// subscription-ish categories (flatrate/free/ads) — but with the WRONG empty value:
// an absent SE block gave `[]`, which blanks a good denormalized array instead of
// meaning "this fetch learned nothing". Its one production caller (taste-backfill)
// therefore fought the title page over `watchlist.providers`. Both provider
// derivations now live in `./seProviderIds`, share the undefined-vs-[] contract, and
// write two distinct fields. Do not reintroduce a third extractor here.
