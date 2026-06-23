import { describe, it, expect } from 'vitest';
import { askFilterToDiscoverParams, describeFilter } from './toDiscoverParams';

describe('askFilterToDiscoverParams', () => {
  it('fetches both media types when mediaType is unset, one when set', () => {
    expect(askFilterToDiscoverParams({})).toMatchObject({ wantMovies: true, wantTV: true });
    expect(askFilterToDiscoverParams({ mediaType: 'movie' })).toMatchObject({ wantMovies: true, wantTV: false });
    expect(askFilterToDiscoverParams({ mediaType: 'tv' })).toMatchObject({ wantMovies: false, wantTV: true });
  });

  it('expands mood into genres and ORs them with explicit genres', () => {
    const { movieParams } = askFilterToDiscoverParams({ genreIds: [27], mood: 'mysig' });
    const genres = movieParams.with_genres.split('|').map(Number).sort((a, b) => a - b);
    // 27 (explicit) + mysig lens [35,10751,10749,16]
    expect(genres).toEqual([16, 27, 35, 10749, 10751]);
  });

  it('prefers explicit providerIds, falls back to the user set only when myProvidersOnly', () => {
    expect(askFilterToDiscoverParams({ providerIds: [8] }, { myProviders: [76] }).movieParams.with_watch_providers).toBe('8');
    expect(askFilterToDiscoverParams({ myProvidersOnly: true }, { myProviders: [8, 76] }).movieParams.with_watch_providers).toBe('8|76');
    expect(askFilterToDiscoverParams({}, { myProviders: [8] }).movieParams.with_watch_providers).toBeUndefined();
  });

  it('maps runtime, vote floor, language and ranking', () => {
    const { movieParams } = askFilterToDiscoverParams({ runtimeMax: 90, voteAverageMin: 7.5, originalLanguage: 'sv', sortBy: 'vote_average.desc' });
    expect(movieParams['with_runtime.lte']).toBe('90');
    expect(movieParams['vote_average.gte']).toBe('7.5');
    expect(movieParams.with_original_language).toBe('sv');
    expect(movieParams.sort_by).toBe('vote_average.desc');
  });

  it('maps decade to release-date windows per media type', () => {
    const { movieParams, tvParams } = askFilterToDiscoverParams({ decade: '1980' });
    expect(movieParams['primary_release_date.gte']).toBe('1980-01-01');
    expect(movieParams['primary_release_date.lte']).toBe('1989-12-31');
    expect(tvParams['first_air_date.gte']).toBe('1980-01-01');
    expect(tvParams['first_air_date.lte']).toBe('1989-12-31');
  });

  it('always sets watch_region SE and a vote_count floor on both media types', () => {
    const { movieParams, tvParams } = askFilterToDiscoverParams({});
    expect(movieParams.watch_region).toBe('SE');
    expect(tvParams.watch_region).toBe('SE');
    expect(movieParams['vote_count.gte']).toBe('100');
    expect(tvParams['vote_count.gte']).toBe('50');
  });
});

describe('describeFilter', () => {
  it('produces readable chips in order, only for set fields', () => {
    const chips = describeFilter({ mediaType: 'movie', genreIds: [27], runtimeMax: 90, decade: '1980', excludeSeen: true, providerIds: [8] });
    // display order is part of the contract
    expect(chips.map((c) => c.key)).toEqual(['mediaType', 'genreIds', 'runtimeMax', 'providerIds', 'excludeSeen', 'decade']);
    const byKey = Object.fromEntries(chips.map((c) => [c.key, c.label]));
    expect(byKey.mediaType).toBe('Filmer');
    expect(byKey.genreIds).toBe('Skräck');
    expect(byKey.runtimeMax).toBe('≤ 90 min');
    expect(byKey.decade).toBe('80-talet');
    expect(byKey.excludeSeen).toBe('Osedda');
    expect(byKey.providerIds).toBe('Netflix');
  });

  it('labels 2000s+ decades with the full year', () => {
    expect(describeFilter({ decade: '2010' }).find((c) => c.key === 'decade')?.label).toBe('2010-talet');
  });

  it('returns no chips for an empty filter', () => {
    expect(describeFilter({})).toEqual([]);
  });
});
