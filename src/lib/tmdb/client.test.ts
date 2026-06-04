import { describe, it, expect, vi } from 'vitest';
import { getDisplayTitle, getReleaseYear, extractYear, getTVShow } from './client';
import type { TMDBSearchResult } from '@/types';

function makeResult(partial: Partial<TMDBSearchResult>): TMDBSearchResult {
  return {
    id: 1,
    media_type: 'movie',
    poster_path: null,
    backdrop_path: null,
    overview: '',
    vote_average: 0,
    genre_ids: [],
    ...partial,
  };
}

describe('extractYear', () => {
  it('returns the 4-digit year from an ISO date', () => {
    expect(extractYear('1999-01-15')).toBe(1999);
    expect(extractYear('2024-12-31')).toBe(2024);
  });

  it('returns null for null / undefined / empty', () => {
    expect(extractYear(null)).toBe(null);
    expect(extractYear(undefined)).toBe(null);
    expect(extractYear('')).toBe(null);
  });

  it('returns null for malformed input', () => {
    expect(extractYear('abcd')).toBe(null);
    expect(extractYear('not-a-date')).toBe(null);
  });
});

describe('getReleaseYear', () => {
  it('reads movie release_date', () => {
    const r = makeResult({ media_type: 'movie', release_date: '2023-06-01' });
    expect(getReleaseYear(r)).toBe(2023);
  });

  it('reads TV first_air_date', () => {
    const r = makeResult({ media_type: 'tv', first_air_date: '2018-09-14' });
    expect(getReleaseYear(r)).toBe(2018);
  });

  it('returns null when neither date is present', () => {
    const r = makeResult({ media_type: 'movie' });
    expect(getReleaseYear(r)).toBe(null);
  });
});

describe('getDisplayTitle', () => {
  it('uses original_title when it is in Latin script', () => {
    const r = makeResult({
      media_type: 'movie',
      title: 'Inception (svensk)',
      original_title: 'Inception',
    });
    expect(getDisplayTitle(r)).toBe('Inception');
  });

  it('uses original_name for TV when Latin', () => {
    const r = makeResult({
      media_type: 'tv',
      name: 'Bron / Broen (sv)',
      original_name: 'Bron / Broen',
    });
    expect(getDisplayTitle(r)).toBe('Bron / Broen');
  });

  it('keeps Swedish å / ä / ö in original title (Latin range)', () => {
    const r = makeResult({
      original_title: 'Män som hatar kvinnor',
      title: 'The Girl with the Dragon Tattoo',
    });
    // Swedish chars are in Latin Extended — original wins.
    expect(getDisplayTitle(r)).toBe('Män som hatar kvinnor');
  });

  it('falls back to localized title when original is CJK', () => {
    const r = makeResult({
      media_type: 'movie',
      title: 'Ringu',
      original_title: 'リング',
    });
    expect(getDisplayTitle(r)).toBe('Ringu');
  });

  it('falls back to localized name when original_name is Korean', () => {
    const r = makeResult({
      media_type: 'tv',
      name: 'Squid Game',
      original_name: '오징어 게임',
    });
    expect(getDisplayTitle(r)).toBe('Squid Game');
  });

  it('falls back to localized when original is Cyrillic', () => {
    const r = makeResult({
      original_title: 'Война и мир',
      title: 'War and Peace',
    });
    expect(getDisplayTitle(r)).toBe('War and Peace');
  });

  it('falls back to localized when original is Arabic', () => {
    const r = makeResult({
      original_title: 'أم كلثوم',
      title: 'Umm Kulthum',
    });
    expect(getDisplayTitle(r)).toBe('Umm Kulthum');
  });

  it('uses original when localized title is missing and original is Latin', () => {
    const r = makeResult({
      original_title: 'Solo Latin Title',
    });
    expect(getDisplayTitle(r)).toBe('Solo Latin Title');
  });

  it('returns localized when both present and localized is non-null, original is non-Latin', () => {
    const r = makeResult({
      title: 'Localized Swedish',
      original_title: '東京物語',
    });
    expect(getDisplayTitle(r)).toBe('Localized Swedish');
  });

  it('returns "Okänd titel" when nothing is present', () => {
    const r = makeResult({});
    expect(getDisplayTitle(r)).toBe('Okänd titel');
  });
});

describe('getTVShow abort', () => {
  it('rejects immediately when the signal is already aborted', async () => {
    // Pre-acquire bailout in tmdbFetch throws AbortError before getApiKey(),
    // acquireSlot() or fetch() run — so this asserts the navigation-away guard.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const ac = new AbortController();
    ac.abort();
    await expect(getTVShow(1, { signal: ac.signal })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
