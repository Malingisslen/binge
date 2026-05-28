'use client';

/**
 * JSON-LD structured data för Schema.org.
 *
 * Google + andra sökmotorer läser JSON-LD som renderas i DOM även om den
 * injiceras efter initial HTML. För title-pages (som vi inte kan server-
 * rendera i static export) är det här enda sättet att få rich-snippet-data
 * in i search results.
 *
 * Använd från title-page-klienter:
 *   <JsonLd data={movieSchema(movie)} />
 *   <JsonLd data={tvSchema(show)} />
 *
 * schema-byggarna returnerar unknown-typade record-objekt eftersom
 * Schema.org-schemana är stora och vi håller en minimal subset för vad
 * Google faktiskt använder i SERP.
 */

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  // dangerouslySetInnerHTML krävs för att React inte ska escapa JSON-strängen.
  // JSON.stringify ensam räcker INTE som injektionsskydd: en sträng som
  // innehåller "</script>" (t.ex. en TMDB-overview) stänger script-blocket i
  // HTML även inuti en JSON-sträng. Vi escapar därför "<" → "<" så
  // sekvensen aldrig kan brytas ut ur blocket (M6).
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

// ---- Builders ----

interface MinimalMovie {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  release_date?: string;
  vote_average?: number;
  vote_count?: number;
  genres?: { id: number; name: string }[];
  credits?: {
    cast: { name: string; character: string }[];
    crew: { name: string; job: string }[];
  };
}

export function movieSchema(movie: MinimalMovie, siteUrl = 'https://binge.nu'): Record<string, unknown> {
  const director = movie.credits?.crew.find(c => c.job === 'Director')?.name;
  const actors = movie.credits?.cast.slice(0, 5).map(c => c.name) ?? [];

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Movie',
    name: movie.title,
    description: movie.overview,
    url: `${siteUrl}/movie/${movie.id}/`,
  };

  if (movie.original_title && movie.original_title !== movie.title) {
    schema.alternateName = movie.original_title;
  }
  if (movie.poster_path) {
    schema.image = `https://image.tmdb.org/t/p/w500${movie.poster_path}`;
  }
  if (movie.release_date) {
    schema.datePublished = movie.release_date;
  }
  if (director) schema.director = { '@type': 'Person', name: director };
  if (actors.length > 0) {
    schema.actor = actors.map(name => ({ '@type': 'Person', name }));
  }
  if (movie.genres && movie.genres.length > 0) {
    schema.genre = movie.genres.map(g => g.name);
  }
  if (movie.vote_average && movie.vote_count && movie.vote_count > 0) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: movie.vote_average,
      bestRating: 10,
      ratingCount: movie.vote_count,
    };
  }

  return schema;
}

interface MinimalTVShow {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  first_air_date?: string;
  last_air_date?: string;
  number_of_seasons?: number;
  vote_average?: number;
  vote_count?: number;
  genres?: { id: number; name: string }[];
  credits?: {
    cast: { name: string; character: string }[];
    crew: { name: string; job: string }[];
  };
}

export function tvSchema(show: MinimalTVShow, siteUrl = 'https://binge.nu'): Record<string, unknown> {
  const creator = show.credits?.crew.find(c => c.job === 'Creator' || c.job === 'Executive Producer')?.name;
  const actors = show.credits?.cast.slice(0, 5).map(c => c.name) ?? [];

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'TVSeries',
    name: show.name,
    description: show.overview,
    url: `${siteUrl}/tv/${show.id}/`,
  };

  if (show.original_name && show.original_name !== show.name) {
    schema.alternateName = show.original_name;
  }
  if (show.poster_path) {
    schema.image = `https://image.tmdb.org/t/p/w500${show.poster_path}`;
  }
  if (show.first_air_date) schema.startDate = show.first_air_date;
  if (show.last_air_date) schema.endDate = show.last_air_date;
  if (show.number_of_seasons) schema.numberOfSeasons = show.number_of_seasons;
  if (creator) schema.creator = { '@type': 'Person', name: creator };
  if (actors.length > 0) {
    schema.actor = actors.map(name => ({ '@type': 'Person', name }));
  }
  if (show.genres && show.genres.length > 0) {
    schema.genre = show.genres.map(g => g.name);
  }
  if (show.vote_average && show.vote_count && show.vote_count > 0) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: show.vote_average,
      bestRating: 10,
      ratingCount: show.vote_count,
    };
  }

  return schema;
}

export function breadcrumbSchema(items: { name: string; url: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function organizationSchema(siteUrl = 'https://binge.nu'): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Binge.nu',
    url: siteUrl,
    logo: `${siteUrl}/og-image.svg`,
    description: 'Svensk mediatracker för film och TV-serier.',
  };
}
