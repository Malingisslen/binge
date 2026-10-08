import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import MoviePageClient from '@/components/pages/MoviePageClient';
import {
  getMovie,
  discoverMovies,
  posterUrl,
} from '@/lib/tmdb/client';
import {
  SEO_CORE_DISCOVER_PAGES,
  SEO_CORE_DISCOVER_PARAMS,
  SEO_FALLBACK_MOVIE_IDS,
  cappedCoreIds,
  latinDisplayIds,
} from '@/lib/tmdb/seoCoverage';
import { resolveSelection, SelectionFloorError } from '@/lib/tmdb/selectionManifest';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { fetchForBuild, buildSignal, startBuildWatchdog, trackBuildCall } from '@/lib/tmdb/buildFetch';
import { recordBuildFetchOutcome } from '@/lib/tmdb/buildCache';
import { buildContentFloor } from '@/lib/seo/contentFloor';
import { movieContentFloorInput } from '@/lib/seo/contentFloorInput';

export const dynamic = 'force-static';
export const dynamicParams = false;

/**
 * Pre-render kärnan av filmer — de populäraste som går att se på en svensk
 * tjänst (ADR 0024) — som riktiga statiska routes. Detta är hörnstenen i SEO-fixen: Googlebot får färdig HTML med
 * korrekt <title>, <meta description>, <link rel="canonical"> och första-
 * paint content INNAN JavaScript körs, istället för "Sidan hittades inte"-
 * skalet som catch-all-routen serverade.
 *
 * Filmer utanför kärnan hanteras av catch-all-routen via client-side
 * rendering och är noindex, även efter hydrering.
 *
 * Sitemap och pre-render MÅSTE adressera samma URL-mängd, annars genererar
 * Google "Genomsökt – inte indexerad" för URLs i ena men inte andra. Sedan
 * BIN-823 vilar den pariteten på en ARTEFAKT, inte på delade konstanter:
 * härledningen här skriver urvalsmanifestet och sitemap.ts läser det.
 */

// React's cache() dedupar fetchen inom samma render-pass — Next anropar
// generateMetadata och default-export separat per route, men cache() ser
// till att TMDB bara träffas en gång per id.
const cachedGetMovie = cache((id: number) => fetchForBuild('movie', getMovie, id));

export async function generateStaticParams(): Promise<{ id: string }[]> {
  // BIN-815: den här fasen (`Collecting page data`) är den som hängde 4 av 6
  // körningar 2026-08-07. Pulsen startas innan första anropet och varje
  // list-hämtning registreras — utan det rapporterar vakthunden `inflight=0`
  // rakt igenom en hängning och pekar utredningen åt fel håll.
  startBuildWatchdog();
  const collectIds = async (
    fetcher: (page: number) => Promise<{ results: { id: number }[] }>,
    pageCount: number,
    kind: string,
  ): Promise<number[]> => {
    const ids: number[] = [];
    const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
    const results = await Promise.allSettled(
      pages.map(p => trackBuildCall(`params:${kind}/p${p}`, () => fetcher(p), { group: 'movie' })),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        // Curation: skip titles that render in a non-Latin alphabet — same rule
        // browsing surfaces already apply (titleFilter.ts). The sitemap inherits
        // the filtering through the manifest (BIN-823), so this is its only site.
        ids.push(...latinDisplayIds(r.value.results));
      }
    }
    return ids;
  };

  try {
    // BIN-823: urvalet persisteras mellan byggen. `derive` körs BARA i
    // veckobygget eller om manifestet saknas/är för gammalt; en vanlig
    // kod-deploy läser bara filen. Tidigare kördes det här varje deploy,
    // och eftersom TMDB:s ranking roterar veckovis roterade urvalet med den:
    // titlar ramlade ur, föll till catch-all-routens noindex och avindexerades.
    const ids = await resolveSelection({
      type: 'movie',
      fallbackIds: SEO_FALLBACK_MOVIE_IDS,
      derive: async () =>
        cappedCoreIds(
          await collectIds(
            p => discoverMovies({ ...SEO_CORE_DISCOVER_PARAMS, page: String(p) }, { signal: buildSignal() }),
            SEO_CORE_DISCOVER_PAGES,
            'core-movies',
          ),
        ),
    });
    return ids.map(id => ({ id: String(id) }));
  } catch (err) {
    // Täckningsgolvet kastar med flit — då SKA bygget falla i stället för att
    // deploya en förkrympt sajt. Fånga därför bara det som inte är golvet.
    if (err instanceof SelectionFloorError) throw err;
    console.warn('[movie/[id]] generateStaticParams TMDB-fetch failed:', err);
    return SEO_FALLBACK_MOVIE_IDS.map(id => ({ id: String(id) }));
  }
}

type PageParams = { id: string };

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { id } = await params;
  const movieId = parseInt(id, 10);
  // Ogiltigt id → sidan kallar notFound() i body. Returnera noindex så den
  // aldrig ärver root-layoutens index:true + canonical:/ (homepage-dubblett).
  if (!Number.isFinite(movieId)) return { robots: { index: false, follow: false } };

  try {
    const movie = await cachedGetMovie(movieId);
    recordBuildFetchOutcome('movie', movieId, true);
    const displayTitle = preferOriginalTitle(movie.title, movie.original_title);
    const releaseYear = movie.release_date ? movie.release_date.slice(0, 4) : '';
    const yearSuffix = releaseYear ? ` (${releaseYear})` : '';
    // Content floor: real overview when substantive, else a generated Swedish
    // availability-first sentence — so empty-overview titles are not thin.
    const description = buildContentFloor(movieContentFloorInput(movie)).description;
    const url = `https://binge.nu/movie/${movieId}/`;
    const image = movie.poster_path ? posterUrl(movie.poster_path, 'w500') : 'https://binge.nu/og-image.png';

    return {
      // Root-layout har title-template '%s — Binge.nu', så inget eget suffix här.
      title: `${displayTitle}${yearSuffix} — var streamar jag?`,
      description,
      alternates: { canonical: url },
      openGraph: {
        title: `${displayTitle}${yearSuffix}`,
        description,
        url,
        siteName: 'Binge.nu',
        locale: 'sv_SE',
        type: 'video.movie',
        images: image ? [{ url: image, width: 500, height: 750, alt: displayTitle }] : undefined,
      },
      twitter: {
        card: 'summary_large_image',
        title: `${displayTitle}${yearSuffix}`,
        description,
        images: image ? [image] : undefined,
      },
    };
  } catch {
    recordBuildFetchOutcome('movie', movieId, false);
    // Build-time TMDB-hämtning misslyckades för denna förrenderade titel. Skicka
    // ALDRIG en indexerbar sida med root-layoutens default-title + canonical:/
    // (Google läser den som en homepage-dubblett). noindex + self-canonical tills
    // ett senare lyckat bygge fyller i riktig metadata; klient-hydrering via
    // usePageMeta sätter rätt title för besökare.
    return {
      title: 'Film',
      robots: { index: false, follow: true },
      alternates: { canonical: `https://binge.nu/movie/${movieId}/` },
    };
  }
}

export default async function MoviePage({ params }: { params: Promise<PageParams> }) {
  const { id } = await params;
  const movieId = parseInt(id, 10);
  if (!Number.isFinite(movieId)) notFound();

  let initialData;
  try {
    initialData = await cachedGetMovie(movieId);
  } catch {
    // Om TMDB failar vid build låter vi MoviePageClient försöka på klient.
    initialData = undefined;
  }

  return <MoviePageClient id={id} initialData={initialData} />;
}
