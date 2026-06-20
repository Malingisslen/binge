// Swedish display names for the standard TMDB genre ids (movie + tv).
// Single source of truth — used by the library filter (BIN-44) and the
// insikter metrics resolvers. genreIds are stored on every watchlist item.

export const GENRE_LABELS: Record<number, string> = {
  28: 'Action', 12: 'Äventyr', 16: 'Animerat', 35: 'Komedi', 80: 'Kriminal',
  99: 'Dokumentär', 18: 'Drama', 10751: 'Familj', 14: 'Fantasy', 36: 'Historia',
  27: 'Skräck', 10402: 'Musik', 9648: 'Mysterium', 10749: 'Romantik',
  878: 'Science Fiction', 10770: 'TV-film', 53: 'Thriller', 10752: 'Krig', 37: 'Western',
  10759: 'Action & Äventyr', 10762: 'Barn', 10763: 'Nyheter', 10764: 'Reality',
  10765: 'Sci-Fi & Fantasy', 10766: 'Såpa', 10767: 'Talkshow', 10768: 'Krig & Politik',
};

export const genreLabel = (id: number): string => GENRE_LABELS[id] ?? `Genre ${id}`;
