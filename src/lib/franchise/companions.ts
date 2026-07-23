// Curated cross-type "companion title" map — TV series that continue as a film
// (and vice versa). TMDB models NO relationship across the movie/TV type boundary:
// `belongs_to_collection` is film-only (see src/lib/seo/franchises.ts) and the TV
// recommendations/similar endpoints never return movies. So a follow-up film like
// El Camino is invisible on the Breaking Bad page unless we link it by hand.
//
// This is the cross-type sibling of the TV-only src/lib/tv/relatedSeries.ts (which
// links split-franchise ERAS of the SAME show). Here each group spans the type
// boundary: a show plus its companion film(s). Curated by hand — TMDB can't derive
// it, so a "candidate finder" would be false precision; new groups come from product
// knowledge, same as relatedSeries.ts and FRANCHISES.
//
// DISPLAY ONLY. It links, it does NOT merge: the show and the film stay separate
// library documents (separate watchlist/progress/status), exactly as decided for the
// Doctor Who split-franchise strip. Labels are hand-written so the crawlable base
// layer needs zero runtime TMDB cost.
//
// Maintenance: to add a group, append a new CompanionTitle[] below with the show and
// its film(s), VERIFY every id against TMDB (a wrong id ships a broken title-page
// link — the structural test can't catch that), and keep entries chronological.
// Append-only.

export interface CompanionTitle {
  /** Which TMDB namespace `id` lives in — a movie and a show can share a number. */
  mediaType: 'movie' | 'tv';
  /** TMDB id within its own mediaType. */
  id: number;
  /** Hand-written chip label (title + year span). Shown as-is; never fetched. */
  label: string;
}

// A companion group = the same fictional story across the type boundary: a show and
// its film(s). Order is chronological (the show first, then films by release year) so
// the section reads in story order. Every group MUST contain ≥1 tv and ≥1 movie — a
// film-only group belongs in FRANCHISES (TMDB collections), a show-only group in
// relatedSeries.ts. (Enforced by companions.test.ts.)
export const COMPANION_GROUPS: CompanionTitle[][] = [
  [
    { mediaType: 'tv', id: 1396, label: 'Breaking Bad · 2008–2013' },
    { mediaType: 'movie', id: 559969, label: 'El Camino: A Breaking Bad Movie · 2019' },
  ],
  [
    { mediaType: 'tv', id: 1437, label: 'Firefly · 2002' },
    { mediaType: 'movie', id: 16320, label: 'Serenity · 2005' },
  ],
  [
    { mediaType: 'tv', id: 1406, label: 'Deadwood · 2004–2006' },
    { mediaType: 'movie', id: 538225, label: 'Deadwood: The Movie · 2019' },
  ],
  [
    { mediaType: 'tv', id: 1920, label: 'Twin Peaks · 1990–1991' },
    { mediaType: 'movie', id: 1923, label: 'Twin Peaks: Fire Walk with Me · 1992' },
  ],
  [
    { mediaType: 'tv', id: 4087, label: 'Arkiv X (The X-Files) · 1993–2018' },
    { mediaType: 'movie', id: 846, label: 'The X-Files: Fight the Future · 1998' },
    { mediaType: 'movie', id: 8836, label: 'The X-Files: I Want to Believe · 2008' },
  ],
  [
    { mediaType: 'tv', id: 105, label: 'Sex and the City · 1998–2004' },
    { mediaType: 'movie', id: 4564, label: 'Sex and the City · 2008' },
    { mediaType: 'movie', id: 37786, label: 'Sex and the City 2 · 2010' },
  ],
  [
    { mediaType: 'tv', id: 1940, label: 'Entourage · 2004–2011' },
    { mediaType: 'movie', id: 188222, label: 'Entourage · 2015' },
  ],
  [
    { mediaType: 'tv', id: 1432, label: 'Veronica Mars · 2004–2019' },
    { mediaType: 'movie', id: 177494, label: 'Veronica Mars · 2014' },
  ],
  [
    { mediaType: 'tv', id: 33907, label: 'Downton Abbey · 2010–2015' },
    { mediaType: 'movie', id: 535544, label: 'Downton Abbey · 2019' },
    { mediaType: 'movie', id: 820446, label: 'Downton Abbey: A New Era · 2022' },
    { mediaType: 'movie', id: 1289936, label: 'Downton Abbey: The Grand Finale · 2025' },
  ],
];

/**
 * The OTHER companion titles in the same group as (`mediaType`, `tmdbId`) — the
 * follow-up film(s) for a show, or the source show (+ sibling films) for a film.
 * Empty array when the title is unmapped. Self-exclusion matches on BOTH mediaType
 * and id, because a movie and a show can share a numeric id (BIN-560).
 */
export function companionsFor(mediaType: 'movie' | 'tv', tmdbId: number): CompanionTitle[] {
  const group = COMPANION_GROUPS.find((g) =>
    g.some((e) => e.mediaType === mediaType && e.id === tmdbId),
  );
  if (!group) return [];
  return group.filter((e) => !(e.mediaType === mediaType && e.id === tmdbId));
}
