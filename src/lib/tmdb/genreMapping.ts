// Genre-id-mappning mellan TMDB:s film- och TV-genrer.
//
// TMDB:s genre-id är inte universella mellan media-typer. Drama (18) finns i
// båda listorna, men Action är 28 för film och 10759 (Action & Adventure) för
// TV. Vissa film-genrer saknar TV-motsvarighet (Horror, Thriller, History,
// Music) och vissa TV-genrer saknar film-motsvarighet (Reality, Talk, News).
//
// Hjälparen används av cross-media discover-anrop när användaren vill
// filtrera rekommendationer per medietyp.

/** Film-genre-id → närmaste TV-genre-id. null = ingen rimlig motsvarighet. */
const MOVIE_TO_TV: Record<number, number | null> = {
  28: 10759,    // Action → Action & Adventure
  12: 10759,    // Adventure → Action & Adventure
  16: 16,       // Animation
  35: 35,       // Comedy
  80: 80,       // Crime
  99: 99,       // Documentary
  18: 18,       // Drama
  10751: 10751, // Family
  14: 10765,    // Fantasy → Sci-Fi & Fantasy
  36: null,     // History — ingen TV-motsvarighet
  27: null,     // Horror — ingen TV-motsvarighet
  10402: null,  // Music — ingen TV-motsvarighet
  9648: 9648,   // Mystery
  10749: null,  // Romance — ingen direkt TV-motsvarighet (Soap är inte detsamma)
  878: 10765,   // Science Fiction → Sci-Fi & Fantasy
  10770: null,  // TV Movie — N/A för rekommendations-bruk
  53: null,     // Thriller — ingen TV-motsvarighet
  10752: 10768, // War → War & Politics
  37: 37,       // Western
};

/** TV-genre-id → närmaste film-genre-id. null = ingen rimlig motsvarighet. */
const TV_TO_MOVIE: Record<number, number | null> = {
  10759: 28,    // Action & Adventure → Action (Adventure 12 är också rimligt)
  16: 16,       // Animation
  35: 35,       // Comedy
  80: 80,       // Crime
  99: 99,       // Documentary
  18: 18,       // Drama
  10751: 10751, // Family
  10762: null,  // Kids — ingen film-motsvarighet
  9648: 9648,   // Mystery
  10763: null,  // News — N/A
  10764: null,  // Reality — N/A
  10765: 878,   // Sci-Fi & Fantasy → Science Fiction
  10766: null,  // Soap — N/A
  10767: null,  // Talk — N/A
  10768: 10752, // War & Politics → War
  37: 37,       // Western
};

/**
 * Mappa en genre-id från en medietyp till motsvarigheten i en annan.
 *
 * Returnerar null om det inte finns någon rimlig motsvarighet, vilket innebär
 * att caller ska skippa genre-filtret för den medietypen (visa allt eller
 * gömma raden).
 */
export function crossMediaGenreId(
  genreId: number,
  fromType: 'movie' | 'tv',
  toType: 'movie' | 'tv',
): number | null {
  if (fromType === toType) return genreId;
  const table = fromType === 'movie' ? MOVIE_TO_TV : TV_TO_MOVIE;
  return table[genreId] ?? null;
}
