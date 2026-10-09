import { describe, it, expect } from 'vitest';
import type { TMDBSearchResult } from '@/types';
import { pickCalibrationCandidates } from './calibrationCandidates';

const NOW = new Date('2026-10-09T12:00:00Z');

const make = (over: Partial<TMDBSearchResult> & { id: number }): TMDBSearchResult => ({
  media_type: 'movie',
  title: 'Parasite',
  poster_path: '/p.jpg',
  backdrop_path: null,
  overview: 'En familj tar sig in i ett rikt hem.',
  vote_average: 8,
  vote_count: 5000,
  release_date: '2019-05-30',
  genre_ids: [18],
  ...over,
});

const ids = (rs: TMDBSearchResult[]) => rs.map(r => r.id);

describe('pickCalibrationCandidates', () => {
  it('keeps a released, described, well-voted Latin-titled film', () => {
    expect(ids(pickCalibrationCandidates([make({ id: 1 })], 10, NOW))).toEqual([1]);
  });

  it('drops a film that is not out yet', () => {
    const future = make({ id: 2, release_date: '2026-12-18' });
    expect(pickCalibrationCandidates([future], 10, NOW)).toEqual([]);
  });

  it('drops a series whose first air date is in the future, and one with no date', () => {
    const future = make({ id: 3, media_type: 'tv', title: undefined, name: 'Ny serie', release_date: undefined, first_air_date: '2027-01-01' });
    const undated = make({ id: 4, release_date: undefined });
    expect(pickCalibrationCandidates([future, undated], 10, NOW)).toEqual([]);
  });

  it('drops titles without an overview', () => {
    expect(pickCalibrationCandidates([make({ id: 5, overview: '  ' })], 10, NOW)).toEqual([]);
  });

  it('drops titles with too few votes', () => {
    expect(pickCalibrationCandidates([make({ id: 6, vote_count: 3 })], 10, NOW)).toEqual([]);
  });

  it('drops a title written only in a non-Latin script', () => {
    const cn = make({ id: 7, media_type: 'tv', title: undefined, name: '时光代理人', release_date: undefined, first_air_date: '2021-04-30' });
    expect(pickCalibrationCandidates([cn], 10, NOW)).toEqual([]);
  });

  it('keeps TMDB order, removes duplicates and caps at the size', () => {
    const rs = [make({ id: 10 }), make({ id: 10 }), make({ id: 11 }), make({ id: 12 })];
    expect(ids(pickCalibrationCandidates(rs, 2, NOW))).toEqual([10, 11]);
  });
  it('puts the vote floor at exactly 50', () => {
    const rs = [make({ id: 10, vote_count: 49 }), make({ id: 11, vote_count: 50 })];
    expect(ids(pickCalibrationCandidates(rs, 10, NOW))).toEqual([11]);
  });

  it('keeps a title released today', () => {
    expect(ids(pickCalibrationCandidates([make({ id: 12, release_date: '2026-10-09' })], 10, NOW))).toEqual([12]);
  });

  it('drops titles without a poster or without genres', () => {
    const rs = [make({ id: 13, poster_path: null }), make({ id: 14, genre_ids: [] })];
    expect(pickCalibrationCandidates(rs, 10, NOW)).toEqual([]);
  });

  it('keeps a film and a series that share a TMDB id', () => {
    const tv = make({ id: 15, media_type: 'tv', title: undefined, name: 'Serie', release_date: undefined, first_air_date: '2020-01-01' });
    expect(ids(pickCalibrationCandidates([make({ id: 15 }), tv], 10, NOW))).toEqual([15, 15]);
  });

  it('drops a person result', () => {
    expect(pickCalibrationCandidates([make({ id: 16, media_type: 'person' as TMDBSearchResult['media_type'] })], 10, NOW)).toEqual([]);
  });
});
