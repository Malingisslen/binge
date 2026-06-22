import { describe, it, expect } from 'vitest';
import { scoreCandidate, pickBestMatch, importStatus } from './matchTitle';
import type { ImportRow } from './parseWatchlistCsv';
import type { TMDBSearchResult } from '@/types';

const row = (over: Partial<ImportRow>): ImportRow => ({
  title: 'Dune', year: 2021, rating: null, imdbId: null, mediaTypeHint: null, ...over,
});

const cand = (over: Partial<TMDBSearchResult>): TMDBSearchResult => ({
  id: 1, media_type: 'movie', title: 'Dune', poster_path: null, backdrop_path: null,
  overview: '', vote_average: 0, genre_ids: [], release_date: '2021-10-22', ...over,
}) as TMDBSearchResult;

describe('scoreCandidate', () => {
  it('disqualifies the wrong media type and person results', () => {
    expect(scoreCandidate(row({}), cand({ media_type: 'person' }))).toBe(0);
  });

  it('disqualifies a title with no overlap', () => {
    expect(scoreCandidate(row({ title: 'Arrival' }), cand({ title: 'Dune' }))).toBe(0);
  });

  it('scores exact title + exact year highest', () => {
    const s = scoreCandidate(row({ title: 'Dune', year: 2021 }), cand({ title: 'Dune', release_date: '2021-10-22' }));
    expect(s).toBeGreaterThanOrEqual(1.5);
  });

  it('penalises a wrong year (same title, different film)', () => {
    const right = scoreCandidate(row({ year: 2021 }), cand({ release_date: '2021-01-01' }));
    const wrong = scoreCandidate(row({ year: 2021 }), cand({ release_date: '1984-01-01' }));
    expect(wrong).toBeLessThan(right);
  });

  it('rewards a matching media-type hint (paired — bonus must actually raise the score)', () => {
    const tvCand = cand({ media_type: 'tv', title: 'Fargo', first_air_date: '2014-04-15', release_date: undefined } as Partial<TMDBSearchResult>);
    const withHint = scoreCandidate(row({ mediaTypeHint: 'tv', title: 'Fargo', year: null }), tvCand);
    const noHint = scoreCandidate(row({ mediaTypeHint: null, title: 'Fargo', year: null }), tvCand);
    expect(withHint).toBeGreaterThan(noHint);
  });

  it('gives a partial bonus for an off-by-one year (between exact and wrong)', () => {
    const exact = scoreCandidate(row({ year: 2021 }), cand({ release_date: '2021-01-01' }));
    const offByOne = scoreCandidate(row({ year: 2021 }), cand({ release_date: '2020-01-01' }));
    const wrong = scoreCandidate(row({ year: 2021 }), cand({ release_date: '1984-01-01' }));
    expect(offByOne).toBeLessThan(exact);
    expect(offByOne).toBeGreaterThan(wrong);
  });
});

describe('pickBestMatch', () => {
  it('picks the exact-year candidate over a same-title wrong-year one', () => {
    const candidates = [
      cand({ id: 99, title: 'Dune', release_date: '1984-12-14' }),
      cand({ id: 1, title: 'Dune', release_date: '2021-10-22' }),
    ];
    expect(pickBestMatch(row({ year: 2021 }), candidates)?.id).toBe(1);
  });

  it('returns null when nothing clears the threshold (conservative — no bad match)', () => {
    // Substring-only match, no year on the row → 0.5 < 1.0 threshold.
    const candidates = [cand({ id: 5, title: 'Dune: Part Two', release_date: '2024-03-01' })];
    expect(pickBestMatch(row({ title: 'Dune', year: null }), candidates)).toBeNull();
  });

  it('returns null for an empty candidate list', () => {
    expect(pickBestMatch(row({}), [])).toBeNull();
  });
});

describe('importStatus', () => {
  it('maps TV to mina regardless of rating', () => {
    expect(importStatus(row({ rating: 8 }), 'tv')).toBe('mina');
    expect(importStatus(row({ rating: null }), 'tv')).toBe('mina');
  });

  it('maps a rated film to sedd and an unrated film to vill_se', () => {
    expect(importStatus(row({ rating: 7 }), 'movie')).toBe('sedd');
    expect(importStatus(row({ rating: null }), 'movie')).toBe('vill_se');
  });
});
