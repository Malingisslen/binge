import { describe, it, expect } from 'vitest';
import {
  scoreCandidates,
  pickMatches,
  nextCandidate,
  participantSwipeProgress,
  type CandidateResult,
} from './matching';
import type {
  SessionCandidate,
  SessionParticipant,
  SessionSwipe,
  TasteVector,
  VoteKind,
} from '@/types';

function cand(tmdbId: number, genreIds: number[] = [], voteAverage = 7): SessionCandidate {
  return {
    tmdbId, mediaType: 'movie', title: `T${tmdbId}`, posterPath: null, year: 2020,
    runtime: 100, genreIds, voteAverage, overview: '', providers: [],
  };
}
function part(id: string): SessionParticipant {
  return {
    id, uid: null, displayName: id, providers: [], vetoRemaining: 1,
    isHost: false, joinedAt: new Date(0), lastActiveAt: new Date(0),
  };
}
function swipe(tmdbId: number, votes: Record<string, VoteKind>): SessionSwipe {
  return { tmdbId, votes, updatedAt: new Date(0) };
}
function taste(genres: Record<number, number>): TasteVector {
  return { genres, sampleSize: Object.keys(genres).length };
}

describe('scoreCandidates — veto', () => {
  it('a single veto sinks the candidate to -Infinity regardless of yes votes', () => {
    const [r] = scoreCandidates({
      candidates: [cand(1)],
      participants: [part('a'), part('b')],
      swipes: [swipe(1, { a: 'yes', b: 'veto' })],
    });
    expect(r.vetoed).toBe(true);
    expect(r.score).toBe(-Infinity);
    expect(r.yesCount).toBe(1);
  });
});

describe('scoreCandidates — vote penalty per strategy (no taste)', () => {
  // 1 yes, 1 no → voteScore = yes - no*penalty. Penalty: least_misery .7, average .5, fair .3.
  const setup = (aggregation: 'least_misery' | 'average' | 'fair') =>
    scoreCandidates({
      candidates: [cand(1)],
      participants: [part('a'), part('b')],
      swipes: [swipe(1, { a: 'yes', b: 'no' })],
      aggregation,
    })[0];

  it('least_misery penalises a no by 0.7', () => {
    expect(setup('least_misery').score).toBeCloseTo(1 - 0.7, 10);
  });
  it('average penalises a no by 0.5', () => {
    expect(setup('average').score).toBeCloseTo(1 - 0.5, 10);
  });
  it('fair penalises a no by 0.3', () => {
    expect(setup('fair').score).toBeCloseTo(1 - 0.3, 10);
  });
});

describe('scoreCandidates — taste aggregation per strategy', () => {
  // No votes → voteScore 0, so score === aggregated taste. Two users: 1.0 and 0.2 on genre 18.
  const base = {
    candidates: [cand(1, [18])],
    participants: [part('a'), part('b')],
    swipes: [] as SessionSwipe[],
    tasteByPid: new Map<string, TasteVector>([
      ['a', taste({ 18: 1.0 })],
      ['b', taste({ 18: 0.2 })],
    ]),
  };

  it('least_misery uses the MIN taste score (no one should hate it)', () => {
    expect(scoreCandidates({ ...base, aggregation: 'least_misery' })[0].tasteScore).toBeCloseTo(0.2, 10);
  });
  it('fair uses the MAX taste score (a single strong pick can win)', () => {
    expect(scoreCandidates({ ...base, aggregation: 'fair' })[0].tasteScore).toBeCloseTo(1.0, 10);
  });
  it('average uses the MEAN taste score', () => {
    expect(scoreCandidates({ ...base, aggregation: 'average' })[0].tasteScore).toBeCloseTo(0.6, 10);
  });
  it('an unknown persisted strategy string falls back to average (no crash)', () => {
    // AggregationStrategy is persisted; a legacy/hand-edited doc must not crash scoring.
    const r = scoreCandidates({ ...base, aggregation: 'weird' as unknown as 'average' })[0];
    expect(r.tasteScore).toBeCloseTo(0.6, 10);
  });
});

describe('pickMatches — threshold, veto, cap, sort', () => {
  const res = (over: Partial<CandidateResult>): CandidateResult => ({
    candidate: cand(over.candidate?.tmdbId ?? 1, [], over.candidate?.voteAverage ?? 7),
    votes: {}, yesCount: 0, noCount: 0, vetoed: false, score: 0, tasteScore: 0,
    allVoted: true, missing: [], ...over,
  });

  it('includes a candidate at EXACTLY 50% yes', () => {
    const out = pickMatches([res({ yesCount: 2, score: 1 })], 4); // 2*2 === 4
    expect(out).toHaveLength(1);
  });
  it('excludes a candidate BELOW 50% yes', () => {
    const out = pickMatches([res({ yesCount: 1, score: 1 })], 4); // 1*2 < 4
    expect(out).toHaveLength(0);
  });
  it('includes an early match (not all voted yet) once it clears half the yes-votes', () => {
    // Guards the `allVoted || yesCount >= ceil(n/2)` OR-branch: a `||`→`&&` regression
    // would drop this (allVoted:false) candidate even though 2/4 already said yes.
    const out = pickMatches([res({ allVoted: false, yesCount: 2, missing: ['c', 'd'], score: 1 })], 4);
    expect(out).toHaveLength(1);
  });
  it('excludes a vetoed candidate even with unanimous yes', () => {
    const out = pickMatches([res({ yesCount: 4, vetoed: true, score: -Infinity })], 4);
    expect(out).toHaveLength(0);
  });
  it('caps the result list at 10', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      res({ candidate: cand(i + 1), yesCount: 2, score: i }));
    expect(pickMatches(many, 2)).toHaveLength(10);
  });
  it('sorts by score desc, breaking ties on candidate voteAverage', () => {
    const out = pickMatches([
      res({ candidate: cand(1, [], 6), yesCount: 2, score: 5 }),
      res({ candidate: cand(2, [], 9), yesCount: 2, score: 5 }), // same score, higher voteAverage
      res({ candidate: cand(3, [], 8), yesCount: 2, score: 9 }), // top score
    ], 2);
    expect(out.map(r => r.candidate.tmdbId)).toEqual([3, 2, 1]);
  });
});

describe('nextCandidate + participantSwipeProgress', () => {
  it('returns the first candidate the participant has not voted on', () => {
    const next = nextCandidate({
      candidates: [cand(1), cand(2), cand(3)],
      swipes: [swipe(1, { a: 'yes' }), swipe(2, { b: 'no' })], // a voted only on 1
      participantId: 'a',
    });
    expect(next?.tmdbId).toBe(2);
  });
  it('returns null when the participant has voted on everything', () => {
    const next = nextCandidate({
      candidates: [cand(1)],
      swipes: [swipe(1, { a: 'yes' })],
      participantId: 'a',
    });
    expect(next).toBeNull();
  });
  it('counts done vs total for a participant', () => {
    const prog = participantSwipeProgress(
      [swipe(1, { a: 'yes' }), swipe(2, { b: 'no' })],
      [cand(1), cand(2), cand(3)],
      'a',
    );
    expect(prog).toEqual({ done: 1, total: 3 });
  });
});
