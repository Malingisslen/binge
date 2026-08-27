/**
 * Delade SEO-täcknings-konstanter.
 *
 * Tre olika ställen i kodbasen pre-renderar TMDB-content för SEO:
 *  - src/app/movie/[id]/page.tsx        (generateStaticParams)
 *  - src/app/tv/[id]/page.tsx           (generateStaticParams)
 *  - src/app/person/[id]/page.tsx       (generateStaticParams)
 *
 * …och src/app/sitemap.ts måste adressera exakt samma URL-mängd.
 *
 * Tidigare drev varje fil sina egna konstanter (POPULAR_PAGES=250 i movie/tv,
 * POPULAR_PAGES=100 i sitemap, ingen person i sitemap). Det skapade en
 * "sitemap har 4k IDs men 5k pre-renderas"-diskrepans som bidrog till
 * "Genomsökt – inte indexerad" i Google Search Console — Google sökte upp
 * URLs via crawling som inte fanns i sitemap. Att lyfta konstanterna hit var
 * första halvan av fixen.
 *
 * Andra halvan kom med BIN-823: sitemapen härleder inte längre alls, utan läser
 * urvalsmanifestet som de tre routerna skrev. Pariteten vilar därmed på EN
 * artefakt i stället för på att två kodvägar råkar ge samma svar. Konstanterna
 * här styr numera bara den färska härledningen.
 *
 * Byggtids-effekt vid SEO_TITLE_PAGES=500:
 *   500 pages × 20 results × 2 källor × 2 mediatyper = 40 000 TMDB-results
 *   innan dedup. ~50-60% overlap mellan popular/top_rated → ~10-12k unika
 *   per mediatyp = ~25k pre-renderade titlar. En KALL full-hämtning tar
 *   ≈ 1.5-2 h — men det gäller bara den veckovisa schemalagda refreshen (eget
 *   175-min-tak på byggsteget; 150 min är namnet på REFRESH_DERIVE_TIMEOUT_MS och
 *   en annan sak). Kod-deployer är budget-bundna (~7-15 min), se buildFetch.ts.
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

// SÄKERHETSNÄT för en ENSKILD härledning, inte täckningstaket.
//
// Det riktiga taket bor sedan BIN-823 i selectionManifest.SELECTION_CEILING och
// tillämpas EFTER att den färska härledningen unionerats med föregående urval.
// Skillnaden är hela spärrhaken: kapas den råa härledningen först når de id:n
// som roterat ut ur TMDB:s topplistor aldrig fram till mergen, och då kan de
// inte behållas — urvalet skulle rotera precis som före BIN-823, fast tystare.
//
// Höjt från 15 000 till 30 000 av just det skälet: värdet ska ligga långt över
// vad TMDB rimligen kan returnera (~10–12k unika per mediatyp enligt räkningen
// ovan) och bara fånga ett absurt svar. Sänk det inte tillbaka till taknivån.
export const SEO_TITLE_TARGET_IDS = 30000;

// Person pre-renderas via top-billed cast från populära filmer.
// SOURCE_MOVIE_PAGES × 20 filmer × CAST_PER_MOVIE cast = innan dedup.
export const SEO_PERSON_SOURCE_MOVIE_PAGES = 100;
export const SEO_PERSON_CAST_PER_MOVIE = 10;
// SPÄRRHAKENS ANDNINGSUTRYMME för personsidorna — inte ett säkerhetsnät som
// titlarnas tal, och inte heller "hur många personsidor vi bygger".
//
// Den invariant som faktiskt avgör om en spärrhake fungerar är TAK > HÄRLEDNING,
// inget annat. Är de lika stora fyller varje färsk härledning taket ensam, mergen
// hamnar alltid över, och evakueringen tar exakt de id:n som ramlat ur veckans
// härledning — resultatet blir identiskt med den färska listan och spärrhaken är
// en matematisk nolloperation. Titlarna klarar sig av en lycklig omständighet:
// härledningen ger ~10–12k mot ett tak på 15 000, alltså 3–5k luft.
//
// Personsidorna hade ingen sådan luft (1 000 mot tak 1 000) och saknade därmed
// spärrhake helt fram till integrationsgranskningen 2026-08-08. Sänkt till 800
// för att skapa den: vi härleder de 800 mest framträdande varje vecka och taket
// rymmer 1 000, så de senast ur-roterade får ligga kvar och fortsätta vara
// indexerade i stället för att svara noindex veckan efter.
//
// Andrummet är 200 PLATSER, inte 200 veckor: en ur-roterad person överlever
// ungefär `200 / veckans utbyte` veckor. Vid ~50 utbytta i veckan blir det en
// månad; byts fler än 200 ut på en vecka är skyddet i praktiken borta igen.
// Mät utbytet innan du drar slutsatser — sänk i så fall det här talet (taket är
// en kostnadsfråga, det här är gratis).
//
// Att i stället HÖJA talet (3 000 prövades under BIN-823) hjälper inte — ett id
// som ramlat ur härledningen evakueras ändå, bara mot en djupare lista. Sänk
// alltså aldrig taket till det här talet, och höj aldrig det här talet till taket.
export const SEO_PERSON_TARGET_IDS = 800;

/**
 * Slå ihop populär- och topp-rankade title-IDs, deduppa och cappa till
 * SEO_TITLE_TARGET_IDS. Anropas av de två titel-routernas `derive` (den färska
 * härledningen). Sitemapen kallar den INTE längre — den läser manifestet, så
 * paritetsinvarianten är strukturell i stället för att bero på att två anropare
 * kör samma funktion (BIN-823).
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
 * titles aren't offered to Google either. Apply this inside every route's
 * `derive`, BEFORE cappedTitleIds/the person cap — the sitemap inherits the
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
 * Normalt fyller TMDB-fetchen listorna med tusentals IDs. Men i miljöer utan
 * giltig TMDB-nyckel failar alla fetchar och listan
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
