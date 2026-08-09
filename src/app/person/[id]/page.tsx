import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PersonPageClient from '@/components/pages/PersonPageClient';
import {
  getPerson,
  profileUrl,
} from '@/lib/tmdb/client';
import { SEO_FALLBACK_PERSON_IDS } from '@/lib/tmdb/seoCoverage';
import { collectPersonIds } from '@/lib/tmdb/seoPersonIds';
import { resolveSelection, SelectionFloorError } from '@/lib/tmdb/selectionManifest';
import { SEED_PERSON_IDS } from '@/lib/seo/selectionSeed';
import { fetchForBuild, buildSignal, startBuildWatchdog, trackBuildCall } from '@/lib/tmdb/buildFetch';
import { prunePersonSeed } from '@/lib/tmdb/personSeed';
import { buildPersonDescription } from '@/lib/seo/contentFloor';
import { personDescriptionInput } from '@/lib/seo/contentFloorInput';

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
 *
 * Urvalet delas med src/app/sitemap.ts via urvalsmanifestet (BIN-823): den här
 * routen härleder och skriver, sitemapen läser samma fil. Tidigare körde båda
 * varsin kopia av samma härledning.
 */

const cachedGetPerson = cache((id: number) => fetchForBuild('person', getPerson, id));

export async function generateStaticParams(): Promise<{ id: string }[]> {
  // BIN-815: den här rutten är den STÖRSTA anroparen i `Collecting page data`
  // — 100 list-sidor plus upp till 2000 detaljhämtningar inne i
  // collectPersonIds. Utan registrering rapporterar vakthunden `inflight=0`
  // genom fasens längsta nätverksarbete, vilket är precis den slutsats
  // ("felet ligger inte i TMDB-lagret") som då blir falsk.
  startBuildWatchdog();
  try {
    // buildSignal injiceras per fetch så ingen byggtids-hämtning når Next
    // 60s-taket. aggregate: etiketten täcker ~2100 anrop i två sekventiella
    // faser, så den har inget eget 20 s-tak. Utan flaggan hade ett FRISKT bygge
    // skrivit STUCK varje puls, och en rad som alltid syns slutar betyda något.
    // BIN-823: den här härledningen — 100 listsidor + ~2 000 rollistor — är den
    // dyraste i hela bygget och den som satt fast i 2 672 sekunder 2026-08-08
    // (BIN-815). Nu körs den bara i veckobygget eller när manifestet saknas, och
    // då under ett fastak; en vanlig kod-deploy läser filen och gör noll anrop.
    const ids = await resolveSelection({
      type: 'person',
      seedIds: SEED_PERSON_IDS,
      fallbackIds: SEO_FALLBACK_PERSON_IDS,
      derive: () =>
        trackBuildCall('params:person-ids', () => collectPersonIds({ signal: buildSignal }), {
          aggregate: true,
        }),
    });
    return ids.map(id => ({ id: String(id) }));
  } catch (err) {
    // Täckningsgolvet ska fälla bygget, inte tystas av fallbacken.
    if (err instanceof SelectionFloorError) throw err;
    console.warn('[person/[id]] generateStaticParams failed:', err);
    return SEO_FALLBACK_PERSON_IDS.map(id => ({ id: String(id) }));
  }
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
    // in i den statiska HTML:en (annars fet payload × ~1000 sidor).
    initialData = prunePersonSeed(await cachedGetPerson(personId));
  } catch {
    initialData = undefined;
  }

  return <PersonPageClient id={id} initialData={initialData} />;
}
