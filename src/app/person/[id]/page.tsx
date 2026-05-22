import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PersonPageClient from '@/components/pages/PersonPageClient';
import {
  getPerson,
  getMovie,
  getPopularMovies,
  profileUrl,
} from '@/lib/tmdb/client';

export const dynamic = 'force-static';
export const dynamicParams = false;

/**
 * Pre-render topp-N personer som riktiga statiska routes. Vi använder
 * top-billed cast från populära filmer som heuristik för "viktiga
 * personer" — det är inte perfekt, men TMDB har ingen "popular people"-
 * endpoint som ger lokala (SE) resultat. Personlänkar finns ändå överallt
 * i UI:n (cast på movie/tv-detaljsidor), så dessa pre-renderade person-
 * sidor stöttar internal-linking-grafen som Google följer.
 *
 * Personer utanför topp-N hanteras via catch-all + client-side rendering.
 */

// 100 pages × 20 filmer × 10 cast/film = ~20k cast-references innan dedup.
// Dedup ger oss ~3-5k unika personer; vi tar topp 1000 (random ordering från
// Set-iteration, men de mest sökta personerna kommer förmodligen återfinnas
// i flera filmer och ranks naturligt högst eftersom de då dyker upp i Set-
// iteration tidigare via fler träffar).
const SOURCE_MOVIE_PAGES = 100;
const CAST_PER_MOVIE = 10;
const TARGET_IDS = 1000;

const cachedGetPerson = cache((id: number) => getPerson(id));

export async function generateStaticParams(): Promise<{ id: string }[]> {
  try {
    // Hämta populära filmer, sen credits per film, sen samla cast-ids.
    const pages = Array.from({ length: SOURCE_MOVIE_PAGES }, (_, i) => i + 1);
    const popularResults = await Promise.allSettled(pages.map(p => getPopularMovies(p)));
    const movieIds = new Set<number>();
    for (const r of popularResults) {
      if (r.status === 'fulfilled') {
        for (const m of r.value.results) movieIds.add(m.id);
      }
    }

    const movieDetails = await Promise.allSettled(
      Array.from(movieIds).map(id => getMovie(id)),
    );
    const peopleIds = new Set<number>();
    for (const r of movieDetails) {
      if (r.status === 'fulfilled') {
        const cast = r.value.credits?.cast ?? [];
        for (const c of cast.slice(0, CAST_PER_MOVIE)) {
          if (c.id) peopleIds.add(c.id);
        }
      }
    }

    const ids = Array.from(peopleIds).slice(0, TARGET_IDS);
    return ids.map(id => ({ id: String(id) }));
  } catch (err) {
    console.warn('[person/[id]] generateStaticParams failed:', err);
    return [];
  }
}

type PageParams = { id: string };

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { id } = await params;
  const personId = parseInt(id, 10);
  if (!Number.isFinite(personId)) return {};

  try {
    const person = await cachedGetPerson(personId);
    const bio = person.biography?.slice(0, 180) ?? '';
    const description = `${person.name}. ${bio || 'Skådespelare och filmskapare.'}`.trim();
    const url = `https://binge.nu/person/${personId}/`;
    const image = person.profile_path ? profileUrl(person.profile_path) ?? undefined : 'https://binge.nu/og-image.svg';

    return {
      title: `${person.name} — filmografi`,
      description,
      alternates: { canonical: url },
      openGraph: {
        title: person.name,
        description,
        url,
        siteName: 'Binge.nu',
        locale: 'sv_SE',
        type: 'profile',
        images: image ? [{ url: image, width: 300, height: 450, alt: person.name }] : undefined,
      },
      twitter: {
        card: 'summary',
        title: person.name,
        description,
        images: image ? [image] : undefined,
      },
    };
  } catch {
    return {};
  }
}

export default async function PersonPage({ params }: { params: Promise<PageParams> }) {
  const { id } = await params;
  const personId = parseInt(id, 10);
  if (!Number.isFinite(personId)) notFound();

  let initialData;
  try {
    initialData = await cachedGetPerson(personId);
  } catch {
    initialData = undefined;
  }

  return <PersonPageClient id={id} initialData={initialData} />;
}
