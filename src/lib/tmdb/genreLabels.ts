// Swedish display names for the standard TMDB genre ids (movie + tv).
// Single source of truth — used by the library filter (BIN-44) and the
// insikter metrics resolvers. genreIds are stored on every watchlist item.

export const GENRE_LABELS: Record<number, string> = {
  28: 'Action', 12: 'Äventyr', 16: 'Animerat', 35: 'Komedi', 80: 'Kriminal',
  99: 'Dokumentär', 18: 'Drama', 10751: 'Familj', 14: 'Fantasy', 36: 'Historia',
  27: 'Skräck', 10402: 'Musik', 9648: 'Mysterium', 10749: 'Romantik',
  878: 'Science fiction', 10770: 'TV-film', 53: 'Thriller', 10752: 'Krig', 37: 'Western',
  10759: 'Action & äventyr', 10762: 'Barn', 10763: 'Nyheter', 10764: 'Reality',
  10765: 'Science fiction & fantasy', 10766: 'Såpa', 10767: 'Talkshow', 10768: 'Krig & politik',
};

export const genreLabel = (id: number): string => GENRE_LABELS[id] ?? `Genre ${id}`;

/**
 * One Swedish genre list for both films and series. TMDB keeps separate ids for
 * the two (and leaves the series-only ones untranslated), so a merged raw list
 * showed "Action" next to "Action & Adventure" and "Science Fiction" next to
 * "Sci-Fi & Fantasy". Each option here carries every id that means the genre,
 * so picking "Action" also finds series filed under TMDB's combined series genre.
 */
export interface GenreOption {
  label: string;
  /** Comma-separated ids — the filter's stored value. */
  value: string;
}

const GENRE_GROUPS: ReadonlyArray<readonly [string, readonly number[]]> = [
  ['Action', [28, 10759]],
  ['Animerat', [16]],
  ['Barn', [10762]],
  ['Dokumentär', [99]],
  ['Drama', [18]],
  ['Familj', [10751]],
  ['Fantasy', [14, 10765]],
  ['Historia', [36]],
  ['Komedi', [35]],
  ['Krig', [10752, 10768]],
  ['Kriminal', [80]],
  ['Musik', [10402]],
  ['Mysterium', [9648]],
  ['Nyheter', [10763]],
  ['Reality', [10764]],
  ['Romantik', [10749]],
  ['Science fiction', [878, 10765]],
  ['Skräck', [27]],
  ['Såpa', [10766]],
  ['Talkshow', [10767]],
  ['Thriller', [53]],
  ['TV-film', [10770]],
  ['Western', [37]],
  ['Äventyr', [12, 10759]],
];

export const GENRE_OPTIONS: readonly GenreOption[] = GENRE_GROUPS.map(([label, ids]) => ({
  label,
  value: ids.join(','),
}));

/** The ids a stored genre filter value stands for; also reads an older single id. */
export function parseGenreFilter(value: string): number[] {
  if (!value) return [];
  return value.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
}
