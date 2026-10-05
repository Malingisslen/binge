import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PersonPageClient from '@/components/pages/PersonPageClient';
import {
  getPerson,
  profileUrl,
} from '@/lib/tmdb/client';
import { SEO_FALLBACK_PERSON_IDS } from '@/lib/tmdb/seoCoverage';
import { fetchForBuild } from '@/lib/tmdb/buildFetch';
import { recordBuildFetchOutcome } from '@/lib/tmdb/buildCache';
import { prunePersonSeed } from '@/lib/tmdb/personSeed';
import { buildPersonDescription } from '@/lib/seo/contentFloor';
import { personDescriptionInput } from '@/lib/seo/contentFloorInput';

export const dynamic = 'force-static';
export const dynamicParams = false;

/**
 * Personsidor förrenderas inte för Google (ADR 0024). Search Console visade dem
 * som de tunnaste sidorna och som tusentals dubbletter. De finns kvar för
 * användare genom catch-all-routen, som är noindex även efter hydrering.
 *
 * Static export kräver minst ett param, så routen bygger bara
 * `SEO_FALLBACK_PERSON_IDS`, och de bär noindex i sin statiska HTML. Ingen
 * sitemap listar dem.
 */

const cachedGetPerson = cache((id: number) => fetchForBuild('person', getPerson, id));

export function generateStaticParams(): { id: string }[] {
  return SEO_FALLBACK_PERSON_IDS.map(id => ({ id: String(id) }));
}

type PageParams = { id: string };

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { id } = await params;
  const personId = parseInt(id, 10);
  // Ogiltigt id → sidan kallar notFound() i body. Returnera noindex så den
  // aldrig ärver root-layoutens index:true + canonical:/ (homepage-dubblett).
  if (!Number.isFinite(personId)) return { robots: { index: false, follow: false } };

  try {
    const person = await cachedGetPerson(personId);
    recordBuildFetchOutcome('person', personId, true);
    // BIN-656/686: the same builder the client uses, through the same adapter, so
    // the pre-rendered description and the one usePageMeta writes at hydration
    // cannot disagree — movie and tv already share their builder across both
    // halves this way. Replaces a hand-sliced 180-char bio that reproduced the
    // near-duplicate description BIN-656 exists to kill.
    const description = buildPersonDescription(personDescriptionInput(person));
    const url = `https://binge.nu/person/${personId}/`;
    const image = person.profile_path ? profileUrl(person.profile_path) ?? undefined : 'https://binge.nu/og-image.png';

    return {
      title: `${person.name} — filmografi`,
      description,
      robots: { index: false, follow: true },
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
    recordBuildFetchOutcome('person', personId, false);
    // Build-time TMDB-hämtning misslyckades för denna förrenderade person. Skicka
    // ALDRIG en indexerbar sida med root-layoutens default-title + canonical:/
    // (Google läser den som en homepage-dubblett). noindex + self-canonical tills
    // ett senare lyckat bygge fyller i riktig metadata; klient-hydrering via
    // usePageMeta sätter rätt title för besökare.
    return {
      title: 'Person',
      robots: { index: false, follow: true },
      alternates: { canonical: `https://binge.nu/person/${personId}/` },
    };
  }
}

export default async function PersonPage({ params }: { params: Promise<PageParams> }) {
  const { id } = await params;
  const personId = parseInt(id, 10);
  if (!Number.isFinite(personId)) notFound();

  let initialData;
  try {
    // BIN-423 WP3: trimma combined_credits till konsumerade fält innan de bakas
    // in i den statiska HTML:en.
    initialData = prunePersonSeed(await cachedGetPerson(personId));
  } catch {
    initialData = undefined;
  }

  return <PersonPageClient id={id} initialData={initialData} />;
}
