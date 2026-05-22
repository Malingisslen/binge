'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';

/**
 * Alla page-clients laddas via next/dynamic så varje route bara drar in
 * sin egen komponent i bundle:n. Utan detta hamnade samtliga 9 clients i
 * first-load JS för [...path]-catch-allen.
 *
 * ssr: false — vi är static export så SSR är ändå inaktiverat.
 * loading: stöder en fallback-placeholder medan chunken laddas.
 */

const LOADING = <div className="text-sm text-text-muted py-4">Laddar...</div>;

// MoviePageClient används som client-side fallback för movie-ids utanför
// topp-N — pre-renderade ids serveras av src/app/movie/[id]/page.tsx,
// resten faller hit via firebase rewrite ** → /_/index.html.
const MoviePageClient = dynamic(() => import('./MoviePageClient'), { ssr: false, loading: () => LOADING });
const TVShowPageClient = dynamic(() => import('./TVShowPageClient'), { ssr: false, loading: () => LOADING });
const SeasonPageClient = dynamic(() => import('./SeasonPageClient'), { ssr: false, loading: () => LOADING });
const PersonPageClient = dynamic(() => import('./PersonPageClient'), { ssr: false, loading: () => LOADING });
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
  if (!mounted) return <>{fallback}</>;

  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] === 'tillsammans' && segments[1] && segments[1] !== 'ny') {
    return <TillsammansSessionPageClient key={segments[1]} id={segments[1]} />;
  }
  if (segments[0] === 'grupper' && segments[1] && segments[1] !== 'ny') {
    return <GroupPageClient key={segments[1]} id={segments[1]} />;
  }
  if (segments[0] === 'user' && segments[1]) {
    return <UserProfilePageClient key={segments[1]} username={segments[1]} />;
  }
  if (segments[0] === 'list' && segments[1]) {
    return <ListPageClient key={segments[1]} listId={segments[1]} />;
  }
  if (segments[0] === 'provider' && segments[1]) {
    return <ProviderPageClient key={segments[1]} id={segments[1]} />;
  }
  if (segments[0] === 'person' && segments[1]) {
    return <PersonPageClient key={segments[1]} id={segments[1]} />;
  }
  if (segments[0] === 'movie' && segments[1]) {
    return <MoviePageClient key={segments[1]} id={segments[1]} />;
  }
  if (segments[0] === 'tv' && segments[1] && segments[2] === 'season' && segments[3]) {
    return <SeasonPageClient key={`${segments[1]}-${segments[3]}`} id={segments[1]} num={segments[3]} />;
  }
  if (segments[0] === 'tv' && segments[1]) {
    return <TVShowPageClient key={segments[1]} id={segments[1]} />;
  }

  return <>{fallback}</>;
}
