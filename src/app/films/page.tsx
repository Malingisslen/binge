import MediaTypePage from '@/components/pages/MediaTypePage';
import { getPopularMovies } from '@/lib/tmdb/client';
import { buildSignal } from '@/lib/tmdb/buildFetch';
import { seedHubItems } from '@/lib/seo/hubSeeds';
import type { TMDBSearchResult } from '@/types';

// Server component: build-fetchar populära filmer och seedar gridden så den
// exporterade statiska HTML:en innehåller crawlbara titellänkar (SEO internal
// linking — samma mönster som /provider/[id]). Metadata bor i layout.tsx.
export default async function FilmsPage() {
  let initialItems: TMDBSearchResult[] = [];
  try {
    const popular = await getPopularMovies(1, { signal: buildSignal() });
    initialItems = seedHubItems(popular.results, { mediaType: 'movie' });
  } catch {
    // TMDB-hick / CI-dummy-nyckel → tom seed; klienten fetchar som idag.
  }
  return <MediaTypePage mediaType="movie" initialItems={initialItems} />;
}
