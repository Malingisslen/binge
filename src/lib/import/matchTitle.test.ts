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

  it('rejects a short title that is a substring of a longer SAME-YEAR title (BIN-144)', () => {
    // "Up" (2009) must NOT match "Up in the Air" (2009): without the length-ratio
    // gate, substring (0.5) + exact year (0.5) = 1.0 would wrongly clear threshold
    // and import the wrong film. Ratio 2/13 ≈ 0.15 < 0.5 → disqualified.
    const candidates = [cand({ id: 7, title: 'Up in the Air', release_date: '2009-12-04' })];
    expect(pickBestMatch(row({ title: 'Up', year: 2009 }), candidates)).toBeNull();
  });

  it('still accepts a substring that is a meaningful fraction of the candidate', () => {
    // "The Matrix" (10) vs row "Matrix" (6): ratio 0.6 > 0.5 → substring credit
    // stands, + exact year clears the threshold.
    const candidates = [cand({ id: 8, title: 'The Matrix', release_date: '1999-03-31' })];
    expect(pickBestMatch(row({ title: 'Matrix', year: 1999 }), candidates)?.id).toBe(8);
  });

  it('rejects exactly-half overlap (ratio == 0.5) — boundary is strictly > 0.5', () => {
    // "Drive" (5) vs "Drive Hard" (10): ratio 0.5, NOT > 0.5 → disqualified even
    // with an exact year. Pins the conservative `<= 0.5` reject boundary.
    const candidates = [cand({ id: 9, title: 'Drive Hard', release_date: '2011-01-01' })];
    expect(pickBestMatch(row({ title: 'Drive', year: 2011 }), candidates)).toBeNull();
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
