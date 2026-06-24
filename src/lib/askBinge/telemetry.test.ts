import { describe, it, expect } from 'vitest';
import { resultBucket, activeFilterSummary, mediaFilterOf } from './telemetry';

describe('resultBucket', () => {
  it('buckets result counts so a zero-result search is its own visible bucket', () => {
    expect(resultBucket(0)).toBe('0');
    expect(resultBucket(1)).toBe('1-9');
    expect(resultBucket(9)).toBe('1-9');
    expect(resultBucket(10)).toBe('10-29');
    expect(resultBucket(29)).toBe('10-29');
    expect(resultBucket(30)).toBe('30+');
    expect(resultBucket(60)).toBe('30+');
  });
});

describe('mediaFilterOf', () => {
  it('reports the media scope as all/movie/tv', () => {
    expect(mediaFilterOf({})).toBe('all');
    expect(mediaFilterOf({ mediaType: 'movie' })).toBe('movie');
    expect(mediaFilterOf({ mediaType: 'tv' })).toBe('tv');
  });
});

describe('activeFilterSummary', () => {
  it('summarizes which filter TYPES are active, sorted, so combos are visible in Plausible', () => {
    // media type is the scope, not a "filter" here — captured by mediaFilterOf instead
    expect(activeFilterSummary({ mediaType: 'movie' })).toBe('none');
    expect(activeFilterSummary({ genreIds: [27], decade: '1980' })).toBe('decade+genre');
    expect(activeFilterSummary({ voteAverageMin: 8, decade: '1980', providerIds: [8] })).toBe(
      'decade+provider+rating',
    );
    expect(activeFilterSummary({ myProvidersOnly: true, excludeSeen: true })).toBe(
      'excludeSeen+myProviders',
    );
    expect(activeFilterSummary({ mood: 'mysig', runtimeMax: 90, originalLanguage: 'sv', sortBy: 'vote_average.desc' })).toBe(
      'language+mood+runtime+sort',
    );
  });

  it('contains no free text — only fixed filter-type names (no PII)', () => {
    const summary = activeFilterSummary({ genreIds: [27], providerIds: [8], decade: '1980' });
    expect(summary).toMatch(/^[a-zA-Z+]+$/);
  });
});
