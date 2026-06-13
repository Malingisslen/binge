import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import MoviePageClient from '@/components/pages/MoviePageClient';
import {
  getMovie,
  getPopularMovies,
  getTopRatedMovies,
  posterUrl,
} from '@/lib/tmdb/client';
import {
  SEO_TITLE_PAGES,
  SEO_TOP_RATED_PAGES,
  SEO_TITLE_TARGET_IDS,
  SEO_FALLBACK_MOVIE_IDS,
} from '@/lib/tmdb/seoCoverage';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { fetchForBuild, buildSignal } from '@/lib/tmdb/buildFetch';

export const dynamic = 'force-static';
export const dynamicParams = false;

/**
 * Pre-render topp-N populära + topp-rankade filmer som riktiga statiska
 * routes. Detta är hörnstenen i SEO-fixen: Googlebot får färdig HTML med
 * korrekt <title>, <meta description>, <link rel="canonical"> och första-
 * paint content INNAN JavaScript körs, istället för "Sidan hittades inte"-
 * skalet som catch-all-routen serverade.
 *
 * Filmer utanför topp-N hanteras fortfarande av catch-all-routen via
 * client-side rendering — godtagbart kompromiss eftersom long-tail har
 * minimal söktrafik.
 *
 * Page-konstanterna delas med src/app/sitemap.ts via @/lib/tmdb/seoCoverage —
 * sitemap och pre-render MÅSTE adressera samma URL-mängd, annars genererar
 * Google "Genomsökt – inte indexerad" för URLs i ena men inte andra.
 */

// React's cache() dedupar fetchen inom samma render-pass — Next anropar
// generateMetadata och default-export separat per route, men cache() ser
// till att TMDB bara träffas en gång per id.
const cachedGetMovie = cache((id: number) => fetchForBuild(getMovie, id));

export async function generateStaticParams(): Promise<{ id: string }[]> {
  const collectIds = async (
    fetcher: (page: number) => Promise<{ results: { id: number }[] }>,
    pageCount: number,
  ): Promise<Set<number>> => {
    const ids = new Set<number>();
    const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
    const results = await Promise.allSettled(pages.map(p => fetcher(p)));
    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const item of r.value.results) {
          if (item.id) ids.add(item.id);
        }
      }
    }
    return ids;
  };

  try {
    const [popular, topRated] = await Promise.all([
      collectIds(p => getPopularMovies(p, { signal: buildSignal() }), SEO_TITLE_PAGES),
      collectIds(p => getTopRatedMovies(p, { signal: buildSignal() }), SEO_TOP_RATED_PAGES),
    ]);
    const merged = new Set<number>([...popular, ...topRated]);
    const ids = Array.from(merged).slice(0, SEO_TITLE_TARGET_IDS);
    // Tom lista (t.ex. CI utan giltig TMDB-nyckel) bryter Next 16:s static
    // export → fall tillbaka på en handfull välkända IDs så builden lyckas.
    const safe = ids.length > 0 ? ids : SEO_FALLBACK_MOVIE_IDS;
    return safe.map(id => ({ id: String(id) }));
  } catch (err) {
    console.warn('[movie/[id]] generateStaticParams TMDB-fetch failed:', err);
    return SEO_FALLBACK_MOVIE_IDS.map(id => ({ id: String(id) }));
  }
}

type PageParams = { id: string };

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { id } = await params;
  const movieId = parseInt(id, 10);
  if (!Number.isFinite(movieId)) return {};

  try {
    const movie = await cachedGetMovie(movieId);
    const displayTitle = preferOriginalTitle(movie.title, movie.original_title);
    const releaseYear = movie.release_date ? movie.release_date.slice(0, 4) : '';
    const yearSuffix = releaseYear ? ` (${releaseYear})` : '';
    const overview = movie.overview?.slice(0, 180) ?? '';
    const description = `${displayTitle}${yearSuffix}. ${overview}`.trim();
    const url = `https://binge.nu/movie/${movieId}/`;
    const image = movie.poster_path ? posterUrl(movie.poster_path, 'w500') : 'https://binge.nu/og-image.svg';

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
    return {};
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
