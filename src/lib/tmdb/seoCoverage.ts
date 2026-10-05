/**
 * Delade SEO-täcknings-konstanter för de förrenderade titelsidorna.
 *
 * Urvalet är en KÄRNA (ADR 0024, 2026-10-05): de populäraste titlarna som går att
 * se på en svensk tjänst, inte TMDB:s hela topplistor. Google läste de tidigare
 * ~29 000 tunna sidorna och valde bort dem; Search Console föll från 260 till en
 * indexerad sida. Taket och spärrhaken bor i selectionManifest.ts, och sitemapen läser
 * manifestet (BIN-823), så pre-render och sitemap kan inte glida isär.
 *
 * Personsidor förrenderas inte för Google längre. Deras route bygger bara
 * `SEO_FALLBACK_PERSON_IDS`, eftersom static export kräver minst ett param.
 */

import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { hasNonLatinTitle } from '@/lib/utils/titleFilter';

// Antal sidor ur /discover per mediatyp, 20 titlar per sida. Hälften av sidorna
// ska räcka över `SELECTION_ABSOLUTE_FLOOR` efter skriftsystemsfiltret, så att ett
// strypt kallt bygge inte fälls av golvet; `seoCoverage.test.ts` pinnar det.
export const SEO_CORE_DISCOVER_PAGES = 100;

// /discover-parametrar för kärnan. `watch_region=SE` sätts redan av
// `discoverMovies`/`discoverTV`; monetiseringsfiltret gör att bara titlar med
// minst en svensk tjänst kommer med, också de som bara går att hyra eller köpa.
export const SEO_CORE_DISCOVER_PARAMS: Readonly<Record<string, string>> = {
  sort_by: 'popularity.desc',
  include_adult: 'false',
  with_watch_monetization_types: 'flatrate|free|ads|rent|buy',
};

// Hur många id en färsk härledning får ge per mediatyp. MÅSTE ligga under
// `SELECTION_CEILING` i selectionManifest.ts: luften däremellan är det som låter
// spärrhaken behålla titlar som roterat ur veckans lista. Är talen lika fyller
// varje härledning taket ensam och spärrhaken blir en nolloperation.
export const SEO_TITLE_TARGET_IDS = 800;

/**
 * Deduppa och kapa en härledning till `SEO_TITLE_TARGET_IDS`. Ordningen är
 * popularitetsordningen från /discover, och Set bevarar den, så kapningen tar
 * de populäraste.
 */
export function cappedCoreIds(ids: readonly number[]): number[] {
  return Array.from(new Set<number>(ids)).slice(0, SEO_TITLE_TARGET_IDS);
}

export interface SeoTitledItem {
  id?: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
}

/**
 * Filter a TMDB list/result set down to the ids whose DISPLAYED title (what
 * preferOriginalTitle actually renders) is Latin-script.
 *
 * Non-Latin-displaying titles (e.g. 侠岚) are already hidden from every browsing
 * surface via hasNonLatinTitle (titleFilter.ts — used on home/discover/lists/
 * recs). This extends the same curation to the SEO pre-render + sitemap so those
 * titles aren't offered to Google either. Apply this inside every route's
 * `derive`, BEFORE cappedCoreIds — the sitemap inherits the
 * filtering through the manifest rather than re-applying it (BIN-823), so a
 * collector that skips this quietly widens BOTH sides at once.
 *
 * Display-based on purpose: a foreign film with a Latin display title (e.g.
 * "Parasite", original 기생충) still renders fine and stays indexed — only titles
 * that actually show in a non-Latin alphabet drop out. Kept pure/network-free so
 * seoCoverage's unit test stays the trustworthy parity guard (ADR 0005).
 */
export function latinDisplayIds(items: ReadonlyArray<SeoTitledItem>): number[] {
  const ids: number[] = [];
  for (const item of items) {
    if (!item.id) continue;
    const displayed = preferOriginalTitle(
      item.title ?? item.name,
      item.original_title ?? item.original_name,
    );
    if (!hasNonLatinTitle(displayed)) ids.push(item.id);
  }
  return ids;
}

/**
 * Fallback-IDs för `generateStaticParams`.
 *
 * Static export (`output: export`) med Next 16 kräver att en dynamisk route
 * med `dynamicParams = false` returnerar minst ETT param från
 * generateStaticParams — en tom array kastar
 * "Page is missing generateStaticParams()" och bryter builden.
 *
 * I miljöer utan giltig TMDB-nyckel failar alla fetchar och listan
 * blir tom. Dessa handfull välkända, stabila TMDB-IDs garanterar att builden
 * alltid producerar ≥1 statisk sida per route. I produktion (riktig nyckel)
 * är de bara en delmängd av den fulla listan — ingen effekt på täckningen.
 */
export const SEO_FALLBACK_MOVIE_IDS = [
  27205, 157336, 155, 550, 13, 680, 278, 238, 424, 603,
];
export const SEO_FALLBACK_TV_IDS = [
  1399, 1396, 66732, 1668, 60625, 456, 62560, 82856, 94605, 1416,
];
export const SEO_FALLBACK_PERSON_IDS = [
  287, 6193, 1245, 500, 31, 192, 62, 3223, 1136406, 18918,
];

/**
 * Provider-landningssidor (BIN-62): kurerad delmängd av SWEDISH_PROVIDERS som
 * pre-renderas som indexerbara /provider/{id}-sidor ("Streama på X i Sverige").
 * Delas mellan src/app/provider/[id]/page.tsx (generateStaticParams) och
 * src/lib/seo/sitemap.ts, OCH används av ProviderPageClient som indexable-gate så
 * att bara dessa sidor sätter index,follow (long-tail-providers via catch-all
 * förblir noindex). Bara mainstream flatrate-tjänster — rent/buy har för tunna
 * kataloger för en "vad kan jag streama"-sida. ~12 sidor × 2 build-fetches =
 * försumbar byggtid, så ingen budget/cache-plumbing behövs.
 */
export const SEO_PROVIDER_IDS = [8, 119, 337, 384, 76, 520, 489, 350, 510, 431, 323];
