import type { MetadataRoute } from 'next';
import { SEO_PROVIDER_IDS } from '@/lib/tmdb/seoCoverage';
import { readSelectionManifest, resolvedIds, allowThinSelection } from '@/lib/tmdb/selectionManifest';
import { SEED_MOVIE_IDS, SEED_TV_IDS, SEED_PERSON_IDS } from '@/lib/seo/selectionSeed';
import { FRANCHISES } from '@/lib/seo/franchises';
import { SEO_GENRE_SLUGS } from '@/lib/seo/genreHubs';
import { buildFetchFailed, readContentChangedAt } from '@/lib/tmdb/buildCache';

/**
 * Sitemapens innehåll, uppdelat per familj (SEO-5). `/sitemap.xml` är ett index
 * över delfilerna i `SITEMAP_PARTS`, så Search Console visar täckningen per
 * familj. Route-filerna under `src/app/sitemap*.xml/` serialiserar det här; de
 * räknar ingenting själva.
 *
 * `lastmod` sätts BARA där den är sann: för titlar och personer är det när sidans
 * innehåll senast ändrades enligt byggcachen (`readContentChangedAt`), och
 * utelämnas när det är okänt. Hubbar och statiska sidor får ingen — byggtiden
 * som stod där förut flyttades på alla URL:er varje bygge och sa ingenting.
 *
 * En titel vars bygghämtning misslyckades renderas `noindex` och lämnas utanför
 * (SEO-13) — sitemapen ska inte be Google indexera en sida som säger nej. Både
 * markören och stämpeln kan ligga ett bygge efter; se `recordBuildFetchOutcome`.
 *
 *
 * Inkluderar:
 * - Statiska offentliga routes (start, discover, films, series,
 *   integritet, villkor, community-guidelines)
 *
 * /savings/ är INTE med (BIN-305): den är auth-gated — crawlers får bara en
 * spinner (tunt/soft-404-innehåll). Den bär istället robots:noindex via sin
 * layout.tsx. Vi Disallow:ar den dock INTE i robots.txt — en blockerad URL kan
 * aldrig crawlas för att SE noindex-direktivet, så noindex + crawlbar är rätt
 * kombination för att hålla den ur indexet.
 * - Topp-N populära + topp-rankade filmer/serier från TMDB
 * - Topp-N personer (top-billed cast från populära filmer)
 *
 * Mål: ge Google en bred "kanonisk lista" av sidor vi anser viktiga, så att
 * indexerings-prioriteten inte tilldelas slumpvis via on-page crawl-discovery.
 *
 * **Sitemap MÅSTE adressera samma URL-mängd som pre-rendren** i
 * src/app/movie/[id]/page.tsx, src/app/tv/[id]/page.tsx och
 * src/app/person/[id]/page.tsx. Diskrepans → "Genomsökt – inte indexerad"
 * i GSC. Sedan BIN-823 garanteras det STRUKTURELLT: både sitemapen och de tre
 * routerna läser samma urvalsmanifest i .tmdb-cache/. Tidigare importerade de
 * bara samma konstanter och körde samma härledning två gånger — paritet som
 * vilade på att två kodvägar råkade ge samma svar.
 *
 * Privata routes (/my, /settings, /stats, /grupper, /feed, /login,
 * /kalibrera) exkluderas eftersom de kräver auth. De har även
 * robots: index: false via sina layout.tsx-filer + Disallow i robots.txt.
 *
 * Körs bara vid build. **Inga TMDB-anrop härifrån längre** — filen läser en
 * lokal artefakt som pre-rendren skrev i en tidigare byggfas. Den KASTAR om
 * manifestet saknas i stället för att falla tillbaka — utom under
 * `SELECTION_ALLOW_THIN`, där den returnerar frö-id:na. Se
 * selectionOrThrow nedan för varför en halv sitemap är värre än inget bygge,
 * och varför undantaget ändå är rätt.
 */

const SITE_URL = 'https://binge.nu';

function staticEntries(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1.0 },
    { url: `${SITE_URL}/discover/`, changeFrequency: 'daily', priority: 0.9 },
    // Hub-of-hubs index (BIN-424) — links every /provider, /billigaste, /forsvinner page.
    { url: `${SITE_URL}/guider/`, changeFrequency: 'weekly', priority: 0.6 },
    // Kalkylatorn (pengakollen publikt). /streamingpriser/ står medvetet utanför:
    // den är noindex via sin layout.tsx tills prisagenten är schemalagd.
    { url: `${SITE_URL}/streamingkostnad/`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/films/`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/series/`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/integritet/`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/villkor/`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/community-guidelines/`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}

/**
 * Titel- och person-URL:er läses ur SAMMA urvalsmanifest som pre-rendren
 * skrev (BIN-823).
 *
 * Tidigare härledde den här filen om hela urvalet på egen hand — en tredje kopia
 * av `collectIds`, plus en andra anropare av den DELADE `collectPersonIds`
 * (ADR 0005: en pipeline, aldrig två kopior — det beslutet står kvar). ~4 100
 * extra TMDB-anrop per bygge. Paritetsinvarianten vilade då på att två oberoende
 * kodvägar råkade ge samma svar; nu är den strukturell: en artefakt, två läsare.
 *
 * Manifesten skrivs i fasen `Collecting page data` (alla `generateStaticParams`)
 * som är helt avslutad innan `Generating static pages` börjar — där den här
 * filen körs. Läsordningen är alltså garanterad av Next, inte av tur.
 *
 * KASTAR om ett manifest saknas. En sitemap som tyst faller tillbaka på bara
 * frö-id:n hade publicerat ~116 URL:er som den kanoniska listan över sajten och
 * bett Google glömma resten — värre än ingen sitemap alls. Routernas
 * täckningsgolv fäller normalt bygget långt innan vi når hit; det här är
 * bältet till det hängslet.
 *
 * …UTOM under `SELECTION_ALLOW_THIN`, samma undantag som golvet. Utan det vore
 * lättnaden bara halv: en strypt personhärledning som slår i ett tidstak skriver
 * ALDRIG något manifest (`resolveSelection` behåller bara det befintliga, och på en
 * kall cache finns inget), så bygget hade fällt här i stället för på golvet.
 * Undantaget är säkert av samma skäl som golvets: `deploy.yml` sätter aldrig
 * flaggan, och det är enda vägen till binge.nu.
 */
function selectionOrThrow(
  type: 'movie' | 'tv' | 'person',
  seedIds: readonly number[],
): number[] {
  const manifest = readSelectionManifest(type);
  if (manifest === null) {
    if (allowThinSelection()) return [...seedIds];
    throw new Error(
      `[sitemap] urvalsmanifestet för ${type} saknas — pre-rendren har inte skrivit det ` +
        `detta bygge. Publicerar hellre ingen sitemap än en som listar en bråkdel av sajten (BIN-823).`,
    );
  }
  return resolvedIds(manifest, seedIds);
}

function selectedEntries(
  kind: 'movie' | 'tv' | 'person',
  seedIds: readonly number[],
  changeFrequency: 'weekly' | 'monthly',
  priority: number,
): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];
  for (const id of selectionOrThrow(kind, seedIds)) {
    if (buildFetchFailed(kind, id)) continue;
    const changedAt = readContentChangedAt(kind, id);
    entries.push({
      url: `${SITE_URL}/${kind}/${id}/`,
      ...(changedAt !== null ? { lastModified: new Date(changedAt) } : {}),
      changeFrequency,
      priority,
    });
  }
  return entries;
}

export function movieSitemapEntries(): MetadataRoute.Sitemap {
  return selectedEntries('movie', SEED_MOVIE_IDS, 'weekly', 0.7);
}

export function tvSitemapEntries(): MetadataRoute.Sitemap {
  return selectedEntries('tv', SEED_TV_IDS, 'weekly', 0.7);
}

export function personSitemapEntries(): MetadataRoute.Sitemap {
  return selectedEntries('person', SEED_PERSON_IDS, 'monthly', 0.5);
}

// Provider-landningssidor (BIN-62) — MÅSTE matcha generateStaticParams i
// src/app/provider/[id]/page.tsx (samma SEO_PROVIDER_IDS) så sitemap och
// pre-render adresserar exakt samma URL-mängd. Inga TMDB-calls (statisk lista).
function providerEntries(): MetadataRoute.Sitemap {
  return SEO_PROVIDER_IDS.map(id => ({
    url: `${SITE_URL}/provider/${id}/`,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));
}

// "Billigaste sättet att se hela [franchise]" (BIN-178) — MÅSTE matcha
// generateStaticParams i src/app/billigaste/[slug]/page.tsx (samma FRANCHISES).
function franchiseEntries(): MetadataRoute.Sitemap {
  return FRANCHISES.map(f => ({
    url: `${SITE_URL}/billigaste/${f.slug}/`,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));
}

// "Vad försvinner från [provider]" (BIN-178) — MÅSTE matcha generateStaticParams
// i src/app/forsvinner/[id]/page.tsx (samma SEO_PROVIDER_IDS). Innehållet
// uppdateras dagligen (klient-läst rollup) → daily changeFrequency.
function forsvinnerEntries(): MetadataRoute.Sitemap {
  return SEO_PROVIDER_IDS.map(id => ({
    url: `${SITE_URL}/forsvinner/${id}/`,
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }));
}

// Genre-landningssidor (BIN-461) — MÅSTE matcha generateStaticParams i
// src/app/genre/[slug]/page.tsx (samma SEO_GENRE_SLUGS). Inga TMDB-calls.
function genreEntries(): MetadataRoute.Sitemap {
  return SEO_GENRE_SLUGS.map(slug => ({
    url: `${SITE_URL}/genre/${slug}/`,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));
}

/** Statiska sidor och hubbar — delfilen `sitemap-sidor.xml`. */
export function pageSitemapEntries(): MetadataRoute.Sitemap {
  return [
    ...staticEntries(),
    ...providerEntries(),
    ...franchiseEntries(),
    ...forsvinnerEntries(),
    ...genreEntries(),
  ];
}

/** Hela URL-mängden över alla delfiler. */
export default function sitemap(): MetadataRoute.Sitemap {
  // Inga try/catch längre, med flit. Tidigare gjorde den här funktionen
  // TMDB-anrop, och då var det rätt att låta en nätverkshick ge en mindre
  // sitemap i stället för ett fällt bygge. Nu läser den en lokal fil som
  // pre-rendren precis skrivit: saknas den har något gått grundligt fel, och en
  // halv sitemap vore ett aktivt felaktigt påstående till Google om vilka sidor
  // sajten har. Låt det kasta — på den enda väg som når binge.nu. Under
  // `SELECTION_ALLOW_THIN` faller selectionOrThrow
  // tillbaka på fröna i stället; de byggena publicerar ingenting till Google.
  return [
    ...pageSitemapEntries(),
    ...movieSitemapEntries(),
    ...tvSitemapEntries(),
    ...personSitemapEntries(),
  ];
}

/** Delfilerna, i den ordning indexet listar dem. Nyckeln är filnamnet. */
export const SITEMAP_PARTS = {
  'sitemap-sidor.xml': pageSitemapEntries,
  'sitemap-filmer.xml': movieSitemapEntries,
  'sitemap-serier.xml': tvSitemapEntries,
  'sitemap-personer.xml': personSitemapEntries,
} as const;

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderUrlset(entries: MetadataRoute.Sitemap): string {
  const urls = entries.map(e => {
    const parts = [`<loc>${escapeXml(e.url)}</loc>`];
    if (e.lastModified) parts.push(`<lastmod>${new Date(e.lastModified).toISOString()}</lastmod>`);
    if (e.changeFrequency) parts.push(`<changefreq>${e.changeFrequency}</changefreq>`);
    if (e.priority !== undefined) parts.push(`<priority>${e.priority}</priority>`);
    return `<url>${parts.join('')}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function renderSitemapIndex(): string {
  const items = Object.keys(SITEMAP_PARTS).map(name => `<sitemap><loc>${SITE_URL}/${name}</loc></sitemap>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</sitemapindex>\n`;
}

export function xmlResponse(body: string): Response {
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
