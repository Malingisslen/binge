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
 *   per mediatyp = ~25k pre-renderade titlar. Build-tid ≈ 1.5-2 h på
 *   GitHub Actions free tier (6h-tak).
 */

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
