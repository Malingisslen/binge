// BIN-461 — curated genre landing pages ("Bästa thrillers att streama i Sverige").
// Single source of truth for /genre/[slug]: the page's generateStaticParams,
// sitemap.ts and hubLinks.ts all read this list, so sitemap == pre-render URL
// set (the seoCoverage.ts contract). Slugs are ASCII (skräck → skrack) — Swedish
// diacritics in URLs survive poorly through sharing/CDN tooling.
//
// Per-media TMDB genre ids are EXPLICIT, not derived at runtime: movie and TV
// use different id spaces (genreMapping.ts) and several genres exist on one
// side only (TV has no Thriller/Skräck/Romantik; a hub omits that section).

export interface GenreHub {
  slug: string;
  /** Short label for hub/footer links ("Thriller"). */
  label: string;
  /** Full H1 ("Bästa thrillers att streama i Sverige"). */
  h1: string;
  metaTitle: string;
  metaDescription: string;
  /** PageHeader standfirst. */
  blurb: string;
  movieGenreId?: number;
  tvGenreId?: number;
}

export const GENRE_HUBS: GenreHub[] = [
  {
    slug: 'thriller',
    label: 'Thriller',
    h1: 'Bästa thrillers att streama i Sverige',
    metaTitle: 'Bästa thrillers att streama i Sverige just nu',
    metaDescription:
      'Vilka thrillers är värda att se — och var streamar de? Populära thrillerfilmer i Sverige, uppdaterat varje vecka på Binge.',
    blurb: 'Populära thrillers just nu och var du kan se dem — sorterat på vad Sverige faktiskt tittar på.',
    movieGenreId: 53,
  },
  {
    slug: 'skrack',
    label: 'Skräck',
    h1: 'Bästa skräckfilmerna att streama i Sverige',
    metaTitle: 'Bästa skräckfilmerna att streama i Sverige just nu',
    metaDescription:
      'Läskigast just nu: populära skräckfilmer och var de streamar i Sverige — Netflix, Viaplay, Max med flera. Uppdaterat på Binge.',
    blurb: 'De mest sedda skräckfilmerna just nu och vilka tjänster som har dem.',
    movieGenreId: 27,
  },
  {
    slug: 'action',
    label: 'Action',
    h1: 'Bästa actionfilmer och actionserier att streama',
    metaTitle: 'Bästa actionfilmer & serier att streama i Sverige',
    metaDescription:
      'Populära actionfilmer och actionserier i Sverige — och var du streamar dem. Uppdaterat varje vecka på Binge.',
    blurb: 'Det mest sedda inom action just nu — filmer och serier, med var de går att se.',
    movieGenreId: 28,
    tvGenreId: 10759,
  },
  {
    slug: 'komedi',
    label: 'Komedi',
    h1: 'Bästa komedier att streama i Sverige',
    metaTitle: 'Bästa komedier att streama i Sverige just nu',
    metaDescription:
      'Populära komedifilmer och humorserier i Sverige — och var de streamar. Uppdaterat varje vecka på Binge.',
    blurb: 'De roligaste filmerna och serierna just nu och var du hittar dem.',
    movieGenreId: 35,
    tvGenreId: 35,
  },
  {
    slug: 'drama',
    label: 'Drama',
    h1: 'Bästa dramafilmer och dramaserier att streama',
    metaTitle: 'Bästa drama att streama i Sverige just nu',
    metaDescription:
      'Populära dramafilmer och dramaserier i Sverige — och var du streamar dem. Uppdaterat varje vecka på Binge.',
    blurb: 'Det starkaste dramat just nu — filmer och serier, med var de går att se.',
    movieGenreId: 18,
    tvGenreId: 18,
  },
  {
    slug: 'deckare',
    label: 'Deckare & krim',
    h1: 'Bästa deckare och kriminalserier att streama',
    metaTitle: 'Bästa deckare & kriminalserier att streama i Sverige',
    metaDescription:
      'Populära deckare, krimfilmer och kriminalserier i Sverige — och var de streamar. Uppdaterat varje vecka på Binge.',
    blurb: 'Krim och deckare som Sverige tittar på just nu, och var du ser dem.',
    movieGenreId: 80,
    tvGenreId: 80,
  },
  {
    slug: 'dokumentarer',
    label: 'Dokumentärer',
    h1: 'Bästa dokumentärer att streama i Sverige',
    metaTitle: 'Bästa dokumentärer att streama i Sverige just nu',
    metaDescription:
      'Populära dokumentärfilmer och dokumentärserier i Sverige — och var de streamar. Uppdaterat varje vecka på Binge.',
    blurb: 'De mest sedda dokumentärerna just nu — filmer och serier, med var de går att se.',
    movieGenreId: 99,
    tvGenreId: 99,
  },
  {
    slug: 'sci-fi',
    label: 'Sci-fi',
    h1: 'Bästa sci-fi att streama i Sverige',
    metaTitle: 'Bästa sci-fi-filmer & serier att streama i Sverige',
    metaDescription:
      'Populär science fiction i Sverige — filmer och serier, och var du streamar dem. Uppdaterat varje vecka på Binge.',
    blurb: 'Den mest sedda science fictionen just nu och vilka tjänster som har den.',
    movieGenreId: 878,
    tvGenreId: 10765,
  },
  {
    slug: 'romantik',
    label: 'Romantik',
    h1: 'Bästa romantiska filmerna att streama i Sverige',
    metaTitle: 'Bästa romantiska filmer att streama i Sverige just nu',
    metaDescription:
      'Populära romantiska filmer i Sverige — och var de streamar. Uppdaterat varje vecka på Binge.',
    blurb: 'De mest sedda romantiska filmerna just nu och var du hittar dem.',
    movieGenreId: 10749,
  },
  {
    slug: 'animerat',
    label: 'Animerat',
    h1: 'Bästa animerade filmer och serier att streama',
    metaTitle: 'Bästa animerade filmer & serier att streama i Sverige',
    metaDescription:
      'Populär animation i Sverige — filmer och serier, och var du streamar dem. Uppdaterat varje vecka på Binge.',
    blurb: 'Det mest sedda animerade just nu — filmer och serier, med var de går att se.',
    movieGenreId: 16,
    tvGenreId: 16,
  },
];

export const SEO_GENRE_SLUGS: string[] = GENRE_HUBS.map((g) => g.slug);

export function genreHubBySlug(slug: string): GenreHub | undefined {
  return GENRE_HUBS.find((g) => g.slug === slug);
}
