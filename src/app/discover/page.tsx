import DiscoverPageClient from '@/components/pages/DiscoverPageClient';
import { getTrending } from '@/lib/tmdb/client';
import { buildSignal } from '@/lib/tmdb/buildFetch';
import { seedHubItems } from '@/lib/seo/hubSeeds';
import type { TMDBSearchResult } from '@/types';

// Server component: build-fetchar veckans trending och seedar gridden så den
// exporterade statiska HTML:en innehåller crawlbara titellänkar (SEO internal
// linking — samma mönster som /provider/[id]). Metadata bor i layout.tsx.
export default async function DiscoverPage() {
  let initialTrending: TMDBSearchResult[] = [];
  try {
    const trending = await getTrending('all', 'week', { signal: buildSignal() });
    initialTrending = seedHubItems(trending.results);
  } catch {
    // TMDB-hick / CI-dummy-nyckel → tom seed; klienten fetchar som idag.
  }
  return <DiscoverPageClient initialTrending={initialTrending} />;
}
