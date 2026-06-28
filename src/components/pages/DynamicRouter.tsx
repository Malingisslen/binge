'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { LoadingView } from '@/components/ui/LoadingView';
import { resolveRoute } from './resolveRoute';

/**
 * Alla page-clients laddas via next/dynamic så varje route bara drar in
 * sin egen komponent i bundle:n. Utan detta hamnade samtliga 9 clients i
 * first-load JS för [...path]-catch-allen.
 *
 * ssr: false — vi är static export så SSR är ändå inaktiverat.
 * loading: stöder en fallback-placeholder medan chunken laddas.
 */

// X2/G6: chunk-fallbacken fronter ALLA dynamiska routes — designad
// LoadingView istället för bar text, men fortsatt lättviktig (ingen layout).
const LOADING = <LoadingView label="Laddar…" />;

// MoviePageClient används som client-side fallback för movie-ids utanför
// topp-N — pre-renderade ids serveras av src/app/movie/[id]/page.tsx,
// resten faller hit via firebase rewrite ** → /_/index.html.
const MoviePageClient = dynamic(() => import(/* webpackPrefetch: true */ './MoviePageClient'), { ssr: false, loading: () => LOADING });
const TVShowPageClient = dynamic(() => import(/* webpackPrefetch: true */ './TVShowPageClient'), { ssr: false, loading: () => LOADING });
const SeasonPageClient = dynamic(() => import('./SeasonPageClient'), { ssr: false, loading: () => LOADING });
const PersonPageClient = dynamic(() => import(/* webpackPrefetch: true */ './PersonPageClient'), { ssr: false, loading: () => LOADING });
const ProviderPageClient = dynamic(() => import('./ProviderPageClient'), { ssr: false, loading: () => LOADING });
const UserProfilePageClient = dynamic(() => import('./UserProfilePageClient'), { ssr: false, loading: () => LOADING });
const ListPageClient = dynamic(() => import('./ListPageClient'), { ssr: false, loading: () => LOADING });
const TillsammansSessionPageClient = dynamic(() => import('./TillsammansSessionPageClient'), { ssr: false, loading: () => LOADING });
const GroupPageClient = dynamic(() => import('./GroupPageClient'), { ssr: false, loading: () => LOADING });

export default function DynamicRouter({ fallback }: { fallback: React.ReactNode }) {
  const pathname = usePathname();
  // Server-renderar catch-all-routen för path `/_` (vår platshållare i
  // generateStaticParams). Vid runtime ser klienten den verkliga URL:en.
  // Skillnaden orsakar React #418 hydration mismatch. Vi gatear all
  // dispatch på mounted så server och initial-hydration alltid renderar
  // fallback, sedan dispatchar vi efter mount via vanlig state-update.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Pre-mount (= prerendrad HTML i out/_/index.html + första klient-rendern):
  // neutral detalj-skeleton, INTE fallbacken. Fallbacken är NotFound-vyn och
  // den prerendrade shellen serverar ALLA long-tail-URL:er via rewriten —
  // en giltig delningslänk ska inte flasha "Sidan hittades inte" innan JS
  // hunnit dispatcha. NotFound visas fortsatt post-mount för omatchade paths
  // (sista return nedan).
  if (!mounted) return <LoadingView variant="detail" label="Laddar…" />;

  // Dispatch logic lives in the pure resolveRoute (tested in resolveRoute.test.ts).
  // This switch only maps the matched route → its lazy page-client, preserving the
  // exact key + prop names the old if-chain used. The `never` default makes adding
  // a RouteMatch kind without a render branch a compile error.
  const match = resolveRoute(pathname);
  if (!match) return <>{fallback}</>;

  switch (match.kind) {
    case 'tillsammans':
      return <TillsammansSessionPageClient key={match.id} id={match.id} />;
    case 'grupper':
      return <GroupPageClient key={match.id} id={match.id} />;
    case 'user':
      return <UserProfilePageClient key={match.username} username={match.username} />;
    case 'list':
      return <ListPageClient key={match.listId} listId={match.listId} />;
    case 'provider':
      return <ProviderPageClient key={match.id} id={match.id} />;
    case 'person':
      return <PersonPageClient key={match.id} id={match.id} />;
    case 'movie':
      return <MoviePageClient key={match.id} id={match.id} />;
    case 'season':
      return <SeasonPageClient key={`${match.id}-${match.num}`} id={match.id} num={match.num} />;
    case 'tv':
      return <TVShowPageClient key={match.id} id={match.id} />;
    default: {
      const _exhaustive: never = match;
      return _exhaustive;
    }
  }
}
