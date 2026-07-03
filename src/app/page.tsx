import HomePageClient from '@/components/pages/HomePageClient';
import { getTrending } from '@/lib/tmdb/client';
import { buildSignal } from '@/lib/tmdb/buildFetch';
import { seedHubItems } from '@/lib/seo/hubSeeds';
import type { TMDBSearchResult } from '@/types';

// Server component: build-fetchar veckans trending och seedar guest-landingens
// trendingsektion så exportens statiska HTML — domänens högst auktoriserade
// sida — innehåller crawlbara titellänkar (SEO internal linking). Sidans hela
// klientbeteende bor i HomePageClient; metadata ärvs från root-layout.
export default async function HomePage() {
  let initialTrending: TMDBSearchResult[] = [];
  try {
    const trending = await getTrending('all', 'week', { signal: buildSignal() });
    // 10 st — matchar trendingsektionens tidigare klient-slice.
    initialTrending = seedHubItems(trending.results, { limit: 10 });
  } catch {
    // TMDB-hick / CI-dummy-nyckel → tom seed; sektionen döljs tills klientens
    // trending-fetch löst, precis som idag.
  }
  return <HomePageClient initialTrending={initialTrending} />;
}
