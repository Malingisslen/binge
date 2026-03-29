'use client';

import { usePathname } from 'next/navigation';
import MoviePageClient from './MoviePageClient';
import TVShowPageClient from './TVShowPageClient';
import SeasonPageClient from './SeasonPageClient';
import PersonPageClient from './PersonPageClient';
import ProviderPageClient from './ProviderPageClient';
import UserProfilePageClient from './UserProfilePageClient';
import ListPageClient from './ListPageClient';

export default function DynamicRouter({ fallback }: { fallback: React.ReactNode }) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] === 'user' && segments[1]) {
    return <UserProfilePageClient username={segments[1]} />;
  }
  if (segments[0] === 'list' && segments[1]) {
    return <ListPageClient listId={segments[1]} />;
  }
  if (segments[0] === 'provider' && segments[1]) {
    return <ProviderPageClient id={segments[1]} />;
  }
  if (segments[0] === 'person' && segments[1]) {
    return <PersonPageClient id={segments[1]} />;
  }
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
