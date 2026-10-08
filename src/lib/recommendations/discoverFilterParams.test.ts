import { describe, it, expect } from 'vitest';
import { discoverDateParams, discoverKeyParts, discoverVoteParams } from './discoverFilterParams';

describe('discoverDateParams', () => {
  it('sets only the bounds that are chosen', () => {
    expect(discoverDateParams({ yearMin: null, yearMax: null }, 'primary_release_date')).toEqual({});
    expect(discoverDateParams({ yearMin: 1990, yearMax: null }, 'primary_release_date'))
      .toEqual({ 'primary_release_date.gte': '1990-01-01' });
    expect(discoverDateParams({ yearMin: null, yearMax: 1999 }, 'first_air_date'))
      .toEqual({ 'first_air_date.lte': '1999-12-31' });
    expect(discoverDateParams({ yearMin: 1990, yearMax: 1999 }, 'first_air_date'))
      .toEqual({ 'first_air_date.gte': '1990-01-01', 'first_air_date.lte': '1999-12-31' });
  });

  it('a row default end applies only while no end year is chosen', () => {
    expect(discoverDateParams({ yearMin: 1980, yearMax: null }, 'primary_release_date', '2016-12-31'))
      .toEqual({ 'primary_release_date.gte': '1980-01-01', 'primary_release_date.lte': '2016-12-31' });
    expect(discoverDateParams({ yearMin: null, yearMax: 2020 }, 'primary_release_date', '2016-12-31'))
      .toEqual({ 'primary_release_date.lte': '2020-12-31' });
  });
});

describe('discoverVoteParams', () => {
  it('asks TMDB for the score that rounds up to the star floor', () => {
    expect(discoverVoteParams({ minStars: 3.5 })).toEqual({ 'vote_average.gte': '6.5' });
    expect(discoverVoteParams({ minStars: 5 })).toEqual({ 'vote_average.gte': '9.5' });
    expect(discoverVoteParams({ minStars: 0 })).toEqual({});
  });
});

describe('discoverKeyParts', () => {
  it('changes when any filter that shapes the query changes', () => {
    const base = { yearMin: 1990, yearMax: 1999, minStars: 3 };
    const key = JSON.stringify(discoverKeyParts(base));
    expect(JSON.stringify(discoverKeyParts({ ...base, yearMin: 1991 }))).not.toBe(key);
    expect(JSON.stringify(discoverKeyParts({ ...base, yearMax: 1998 }))).not.toBe(key);
    expect(JSON.stringify(discoverKeyParts({ ...base, minStars: 3.5 }))).not.toBe(key);
  });
});
