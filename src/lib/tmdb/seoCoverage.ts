/**
 * Delade SEO-täcknings-konstanter.
 *
 * Tre olika ställen i kodbasen pre-renderar TMDB-content för SEO:
 *  - src/app/movie/[id]/page.tsx        (generateStaticParams)
 *  - src/app/tv/[id]/page.tsx           (generateStaticParams)
 *  - src/app/person/[id]/page.tsx       (generateStaticParams)
 *
 * …och en plats genererar sitemap:
 *  - src/app/sitemap.ts
 *
 * Tidigare drev varje fil sina egna konstanter (POPULAR_PAGES=250 i movie/tv,
 * POPULAR_PAGES=100 i sitemap, ingen person i sitemap). Det skapade en
 * "sitemap har 4k IDs men 5k pre-renderas"-diskrepans som bidrog till
 * "Genomsökt – inte indexerad" i Google Search Console — Google sökte upp
 * URLs via crawling som inte fanns i sitemap.
 *
 * Genom att lyfta konstanterna hit garanteras att sitemap och pre-render
 * adresserar exakt samma URL-mängd.
 *
 * Byggtids-effekt vid SEO_TITLE_PAGES=500:
 *   500 pages × 20 results × 2 källor × 2 mediatyper = 40 000 TMDB-results
 *   innan dedup. ~50-60% overlap mellan popular/top_rated → ~10-12k unika
 *   per mediatyp = ~25k pre-renderade titlar. En KALL full-hämtning tar
 *   ≈ 1.5-2 h — men det gäller bara den veckovisa schemalagda refreshen (egen
 *   150-min-timeout). Kod-deployer är budget-bundna (~7-15 min), se buildFetch.ts.
 *
 * Byggtids-resiliens (2026-06): varje byggtids-TMDB-anrop har en
 * AbortSignal.timeout (src/lib/tmdb/buildFetch.ts) så ingen sida kan nå Next
 * 60s static-generation-tak — exporten avbryts aldrig. Detaljsvaren cachas
 * dessutom på disk (src/lib/tmdb/buildCache.ts, .tmdb-cache/, persistas via
 * actions/cache) så kod-deployer återanvänder titeldata istället för att
 * hämta om ~25k titlar. Färskhet via rullande, BUDGETERAD refresh
 * (buildFetch.ts): kod-deployer re-hämtar bara en tidsbunden andel stale
 * titlar; den veckovisa schemalagda deployen kör med stor budget för full
 * refresh. Höj därför INTE sidantalet för att "spara byggtid" — kod-deployens
 * byggtid domineras av cache-träffar, inte fetch.
 */

import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { hasNonLatinTitle } from '@/lib/utils/titleFilter';

// Antal TMDB-pages från /movie/popular respektive /tv/popular vi pre-renderar.
// Höj med försiktighet — varje ökning med 100 pages ger ~10-15 min extra build.
export const SEO_TITLE_PAGES = 500;

// Antal pages från /movie/top_rated och /tv/top_rated.
// Top_rated har stor överlapp med popular för svenska/populära titlar, så
// effekten på unika IDs är mindre än SEO_TITLE_PAGES.
export const SEO_TOP_RATED_PAGES = 500;

// Tak för pre-renderade IDs per mediatyp efter dedup. Säkerhetsnet om TMDB
// returnerar oväntat många unika ids. Sätt högt — vill inte cap:a den
// faktiska täckningen.
export const SEO_TITLE_TARGET_IDS = 15000;

// Person pre-renderas via top-billed cast från populära filmer.
// SOURCE_MOVIE_PAGES × 20 filmer × CAST_PER_MOVIE cast = innan dedup.
export const SEO_PERSON_SOURCE_MOVIE_PAGES = 100;
export const SEO_PERSON_CAST_PER_MOVIE = 10;
export const SEO_PERSON_TARGET_IDS = 1000;

/**
 * Slå ihop populär- och topp-rankade title-IDs, deduppa och cappa till
 * SEO_TITLE_TARGET_IDS — den ENDA källan för "vilken title-URL-mängd
 * adresserar vi?". Både sitemap (src/app/sitemap.ts) och pre-rendren
 * (src/app/{movie,tv}/[id]/page.tsx) MÅSTE kalla denna så de träffar EXAKT
 * samma id-mängd; annars genererar Google "Genomsökt – inte indexerad".
 *
 * Ordningen är load-bearing: `popular` först, sedan `topRated`. Set bevarar
 * insättningsordning, så slicen tar de första SEO_TITLE_TARGET_IDS unika
 * ids i den ordningen. Ändra inte ordningen utan att ändra alla konsumenter
 * samtidigt.
 */
export function cappedTitleIds(popular: number[], topRated: number[]): number[] {
  return Array.from(new Set<number>([...popular, ...topRated])).slice(0, SEO_TITLE_TARGET_IDS);
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
 * titles aren't offered to Google either. Apply this identically inside EVERY
 * collector BEFORE cappedTitleIds/the person cap, so sitemap and pre-render keep
 * addressing the exact same URL set (the load-bearing parity invariant).
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
 * Normalt fyller TMDB-fetchen listorna med tusentals IDs. Men i miljöer utan
 * giltig TMDB-nyckel (t.ex. CI:s `ci-dummy`) failar alla fetchar och listan
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
 * src/app/sitemap.ts, OCH används av ProviderPageClient som indexable-gate så
 * att bara dessa sidor sätter index,follow (long-tail-providers via catch-all
 * förblir noindex). Bara mainstream flatrate-tjänster — rent/buy har för tunna
 * kataloger för en "vad kan jag streama"-sida. ~12 sidor × 2 build-fetches =
 * försumbar byggtid (jfr. ~25k titlar), så ingen budget/cache-plumbing behövs.
 */
export const SEO_PROVIDER_IDS = [8, 119, 337, 384, 76, 520, 489, 350, 510, 431, 323];
