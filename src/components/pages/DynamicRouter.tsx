'use client';

import { usePathname } from 'next/navigation';
import MoviePageClient from './MoviePageClient';
import TVShowPageClient from './TVShowPageClient';
import SeasonPageClient from './SeasonPageClient';

export default function DynamicRouter({ fallback }: { fallback: React.ReactNode }) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] === 'movie' && segments[1]) {
    return <MoviePageClient id={segments[1]} />;
  }
  if (segments[0] === 'tv' && segments[1] && segments[2] === 'season' && segments[3]) {
    return <SeasonPageClient id={segments[1]} num={segments[3]} />;
  }
  if (segments[0] === 'tv' && segments[1]) {
    return <TVShowPageClient id={segments[1]} />;
  }

  return <>{fallback}</>;
}
