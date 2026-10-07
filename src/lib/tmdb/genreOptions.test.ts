import { describe, it, expect } from 'vitest';
import { GENRE_OPTIONS, GENRE_LABELS, parseGenreFilter } from './genreLabels';

describe('GENRE_OPTIONS', () => {
  it('lists each genre name once', () => {
    const labels = GENRE_OPTIONS.map(o => o.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('covers every TMDB genre id with a Swedish label', () => {
    const covered = new Set(GENRE_OPTIONS.flatMap(o => parseGenreFilter(o.value)));
    for (const id of Object.keys(GENRE_LABELS).map(Number)) expect(covered.has(id)).toBe(true);
  });

  it('shows none of the untranslated TMDB series genre names', () => {
    const labels = GENRE_OPTIONS.map(o => o.label);
    for (const english of ['Action & Adventure', 'Sci-Fi & Fantasy', 'War & Politics', 'Kids', 'News', 'Soap', 'Talk']) {
      expect(labels).not.toContain(english);
    }
    expect(labels).toContain('Science fiction');
  });

  it('is in Swedish alphabetical order', () => {
    const labels = GENRE_OPTIONS.map(o => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'sv')));
  });
});

describe('parseGenreFilter', () => {
  it('reads a merged value, an older single id, and an empty filter', () => {
    expect(parseGenreFilter('28,10759')).toEqual([28, 10759]);
    expect(parseGenreFilter('53')).toEqual([53]);
    expect(parseGenreFilter('')).toEqual([]);
  });
});
