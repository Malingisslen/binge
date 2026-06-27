// BIN-178 — curated franchise catalog for /billigaste/[slug] landing pages.
// Each entry maps a stable TMDB *collection* id to a URL slug + display name.
// Kept small and hand-picked (high search intent, low Swedish competition) — the
// page fetches getCollection(collectionId) at build, so a wrong id yields an
// empty collection → the page calls notFound() (no thin page ships).
//
// Slugs are the indexable URL (/billigaste/marvel). Add entries here + they flow
// into generateStaticParams AND the sitemap automatically.

export interface Franchise {
  /** TMDB collection id. */
  collectionId: number;
  /** URL slug (kebab-case, ASCII). */
  slug: string;
  /** Display name used in title/H1 copy. */
  name: string;
}

export const FRANCHISES: Franchise[] = [
  { collectionId: 86311, slug: 'marvel', name: 'Marvel Cinematic Universe' },
  { collectionId: 1241, slug: 'harry-potter', name: 'Harry Potter' },
  { collectionId: 10, slug: 'star-wars', name: 'Star Wars' },
  { collectionId: 119, slug: 'sagan-om-ringen', name: 'Sagan om ringen' },
  { collectionId: 121938, slug: 'hobbit', name: 'Hobbit' },
  { collectionId: 645, slug: 'james-bond', name: 'James Bond' },
  { collectionId: 9485, slug: 'fast-and-furious', name: 'Fast & Furious' },
  { collectionId: 328, slug: 'jurassic-park', name: 'Jurassic Park' },
  { collectionId: 87359, slug: 'mission-impossible', name: 'Mission: Impossible' },
  { collectionId: 295, slug: 'pirates-of-the-caribbean', name: 'Pirates of the Caribbean' },
  { collectionId: 131635, slug: 'hunger-games', name: 'The Hunger Games' },
  { collectionId: 10194, slug: 'toy-story', name: 'Toy Story' },
  { collectionId: 2150, slug: 'shrek', name: 'Shrek' },
  { collectionId: 2344, slug: 'matrix', name: 'The Matrix' },
  { collectionId: 404609, slug: 'john-wick', name: 'John Wick' },
  { collectionId: 84, slug: 'indiana-jones', name: 'Indiana Jones' },
  { collectionId: 8650, slug: 'transformers', name: 'Transformers' },
  { collectionId: 8091, slug: 'alien', name: 'Alien' },
  { collectionId: 528, slug: 'terminator', name: 'The Terminator' },
  { collectionId: 748, slug: 'x-men', name: 'X-Men' },
  { collectionId: 33514, slug: 'twilight', name: 'Twilight' },
  { collectionId: 86066, slug: 'despicable-me', name: 'Dumma mej & Minionerna' },
  { collectionId: 8354, slug: 'ice-age', name: 'Ice Age' },
  { collectionId: 263, slug: 'batman-nolan', name: 'The Dark Knight-trilogin' },
];

export function franchiseBySlug(slug: string): Franchise | undefined {
  return FRANCHISES.find((f) => f.slug === slug);
}
