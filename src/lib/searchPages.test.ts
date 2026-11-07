import { describe, it, expect } from 'vitest';
import { mergeSearchPages, nextSearchPage, TMDB_MAX_PAGE } from './searchPages';
import type { TMDBSearchResult } from '@/types';

const item = (media_type: 'movie' | 'tv' | 'person', id: number) =>
  ({ media_type, id }) as TMDBSearchResult;

describe('nextSearchPage', () => {
  it('points at the following page while pages remain', () => {
    expect(nextSearchPage({ page: 1, total_pages: 3 })).toBe(2);
    expect(nextSearchPage({ page: 2, total_pages: 3 })).toBe(3);
  });

  it('stops on the last page, and on an empty result', () => {
    expect(nextSearchPage({ page: 3, total_pages: 3 })).toBeUndefined();
    expect(nextSearchPage({ page: 1, total_pages: 0 })).toBeUndefined();
  });

  it('never asks for a page beyond the TMDB cap', () => {
    expect(nextSearchPage({ page: TMDB_MAX_PAGE, total_pages: 9000 })).toBeUndefined();
  });
});

describe('mergeSearchPages', () => {
  it('keeps page order and drops a title repeated on a later page', () => {
    const merged = mergeSearchPages([
      { results: [item('movie', 1), item('tv', 2)] },
      { results: [item('tv', 2), item('movie', 3)] },
    ]);
    expect(merged.map(r => `${r.media_type}-${r.id}`)).toEqual(['movie-1', 'tv-2', 'movie-3']);
  });

  it('treats a movie and a series with the same id as different titles', () => {
    expect(mergeSearchPages([{ results: [item('movie', 7), item('tv', 7)] }])).toHaveLength(2);
  });
});
