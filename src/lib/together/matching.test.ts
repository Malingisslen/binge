import { describe, it, expect } from 'vitest';
import {
  scoreCandidates,
  pickMatches,
  nextCandidate,
  participantSwipeProgress,
  type CandidateResult,
} from './matching';
import { parseTmdbIdFromDocId, parseMediaTypeFromDocId } from '@/lib/mediaTypeDocId';
import type {
  MediaType,
  SessionCandidate,
  SessionParticipant,
  SessionSwipe,
  TasteVector,
  VoteKind,
} from '@/types';

function cand(
  tmdbId: number,
  genreIds: number[] = [],
  voteAverage = 7,
  mediaType: MediaType = 'movie',
): SessionCandidate {
  return {
    tmdbId, mediaType, title: `T${tmdbId}`, posterPath: null, year: 2020,
    runtime: 100, genreIds, voteAverage, overview: '', providers: [],
  };
}
function part(id: string): SessionParticipant {
  return {
    id, uid: null, displayName: id, providers: [], vetoRemaining: 1,
    isHost: false, joinedAt: new Date(0), lastActiveAt: new Date(0),
  };
}
// mediaType null = ett legacy-swipe-doc namngivet på bara tmdbId (pre-BIN-569).
function swipe(
  tmdbId: number,
  votes: Record<string, VoteKind>,
  mediaType: MediaType | null = 'movie',
): SessionSwipe {
  return { tmdbId, mediaType, votes, updatedAt: new Date(0) };
}
// Ett swipe-doc så som det ser ut EFTER läsning: id:t tolkas med exakt samma
// två funktioner som swipeDocToObject använder, så testerna nedan mäter den
// riktiga läsvägen och inte en handrullad kopia av den.
function swipeFromDocId(docId: string, votes: Record<string, VoteKind>): SessionSwipe {
  return {
    tmdbId: parseTmdbIdFromDocId(docId),
    mediaType: parseMediaTypeFromDocId(docId),
    votes,
    updatedAt: new Date(0),
  };
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

// BIN-569 — TMDB:s film- och serie-id:n är skilda nummerrymder. En "Blandat"-
// session kan dela ut både film 42 och serie 42; på bara numret slogs deras
// röster ihop till ett gemensamt (fel) matchresultat.
describe('media-type namespacing of swipes (BIN-569)', () => {
  const movie42 = cand(42, [], 7, 'movie');
  const tv42 = cand(42, [], 7, 'tv');

  it('film 42 and serie 42 never share a vote tally', () => {
    const [m, t] = scoreCandidates({
      candidates: [movie42, tv42],
      participants: [part('a'), part('b')],
      swipes: [
        swipe(42, { a: 'yes', b: 'yes' }, 'movie'),
        swipe(42, { a: 'no', b: 'no' }, 'tv'),
      ],
    });
    expect([m.yesCount, m.noCount]).toEqual([2, 0]);
    expect([t.yesCount, t.noCount]).toEqual([0, 2]);
  });

  it('a veto on serie 42 does NOT sink film 42', () => {
    const [m, t] = scoreCandidates({
      candidates: [movie42, tv42],
      participants: [part('a')],
      swipes: [swipe(42, { a: 'veto' }, 'tv')],
    });
    expect(m.vetoed).toBe(false);
    expect(t.vetoed).toBe(true);
  });

  it('voting on film 42 leaves serie 42 unswiped for next-candidate and progress', () => {
    const swipes = [swipe(42, { a: 'yes' }, 'movie')];
    const next = nextCandidate({ candidates: [movie42, tv42], swipes, participantId: 'a' });
    expect(next?.mediaType).toBe('tv');
    expect(participantSwipeProgress(swipes, [movie42, tv42], 'a')).toEqual({ done: 1, total: 2 });
  });

  it('a legacy bare-id swipe doc still counts, so an in-flight session keeps its votes', () => {
    const [m] = scoreCandidates({
      candidates: [movie42],
      participants: [part('a')],
      swipes: [swipe(42, { a: 'yes' }, null)],
    });
    expect(m.yesCount).toBe(1);
  });

  it('a namespaced swipe doc wins over a legacy one for the same number', () => {
    const [m] = scoreCandidates({
      candidates: [movie42],
      participants: [part('a')],
      swipes: [swipe(42, { a: 'no' }, null), swipe(42, { a: 'yes' }, 'movie')],
    });
    expect([m.yesCount, m.noCount]).toEqual([1, 0]);
  });
});

// BIN-608 — `swipes.votes` är en MAP som varje deltagare skriver in sin egen
// nyckel i. En fallback på DOKUMENT-nivå ("finns namngivet doc? använd det,
// annars legacy") betyder att den FÖRSTA rösten efter övergången skapar ett
// namngivet doc med en enda röst i — och det dokumentet gömmer legacy-doc:et
// där alla andras röster ligger. Testerna nedan seedar OLIKA deltagare i de
// två dokumenten; annars kan de inte skilja dokument-val från värde-merge.
describe('legacy and namespaced swipe docs merge per participant (BIN-608)', () => {
  const movie42 = cand(42, [], 7, 'movie');
  const tv42 = cand(42, [], 7, 'tv');

  it('a post-cutover vote does not hide the pre-cutover votes on the same title', () => {
    const [m] = scoreCandidates({
      candidates: [movie42],
      participants: [part('a'), part('b'), part('c')],
      swipes: [
        swipe(42, { b: 'yes', c: 'yes' }, null),   // före övergången
        swipe(42, { a: 'yes' }, 'movie'),          // första rösten efter
      ],
    });
    expect(m.yesCount).toBe(3);
    expect(m.allVoted).toBe(true);
    expect(m.missing).toEqual([]);
  });

  it('a participant who voted in both docs resolves to the namespaced (newer) vote', () => {
    const [m] = scoreCandidates({
      candidates: [movie42],
      participants: [part('a'), part('b')],
      swipes: [
        swipe(42, { a: 'no', b: 'yes' }, null),
        swipe(42, { a: 'yes' }, 'movie'),
      ],
    });
    expect([m.yesCount, m.noCount]).toEqual([2, 0]);
  });

  it('a veto held only in the legacy doc still sinks the candidate', () => {
    const [m] = scoreCandidates({
      candidates: [movie42],
      participants: [part('a'), part('b')],
      swipes: [
        swipe(42, { b: 'veto' }, null),
        swipe(42, { a: 'yes' }, 'movie'),
      ],
    });
    expect(m.vetoed).toBe(true);
    expect(m.score).toBe(-Infinity);
  });

  it('a pre-cutover voter is not re-asked the same title after the cutover', () => {
    const swipes = [
      swipe(42, { b: 'yes' }, null),
      swipe(42, { a: 'yes' }, 'movie'),
    ];
    expect(nextCandidate({ candidates: [movie42], swipes, participantId: 'b' })).toBeNull();
    expect(participantSwipeProgress(swipes, [movie42], 'b')).toEqual({ done: 1, total: 1 });
  });

  it('namespaced votes stay apart per media type even when a legacy doc is merged in', () => {
    const [m, t] = scoreCandidates({
      candidates: [movie42, tv42],
      participants: [part('a'), part('b'), part('c')],
      swipes: [
        swipe(42, { c: 'yes' }, null),             // tvetydig: kan ha gällt endera
        swipe(42, { a: 'yes' }, 'movie'),
        swipe(42, { a: 'no', b: 'no' }, 'tv'),
      ],
    });
    // De namngivna rösterna delas ALDRIG mellan medietyperna (BIN-569 håller).
    expect([m.yesCount, m.noCount]).toEqual([2, 0]);   // a (movie) + c (legacy)
    expect([t.yesCount, t.noCount]).toEqual([1, 2]);   // c (legacy) + a, b (tv)
  });

  // Medveten kompromiss, inte drift: ett legacy-doc på bara `42` går inte att
  // härleda till film eller serie — den tvetydigheten ÄR buggen BIN-569 rättade
  // och ligger redan i skriven data. Vi slår in det i båda hellre än att slänga
  // rösten. Detta är en skillnad mot mellanläget i 0c83c45, som tystade legacy-
  // doc:et så fort ett namngivet doc fanns (och därmed tappade rösten helt).
  it('an unattributable legacy veto sinks BOTH media types — accepted tradeoff', () => {
    const [m, t] = scoreCandidates({
      candidates: [movie42, tv42],
      participants: [part('a'), part('b')],
      swipes: [
        swipe(42, { b: 'veto' }, null),
        swipe(42, { a: 'yes' }, 'tv'),
      ],
    });
    expect(m.vetoed).toBe(true);
    expect(t.vetoed).toBe(true);
    expect(t.votes).toEqual({ b: 'veto', a: 'yes' });
  });
});

// BIN-618 — swipe-doc:ens id är fritt skrivbart av den som har sessionslänken.
// `movie_042` är ett ALIAS för samma tal som den äkta nyckeln `movie_42`: läste
// vi det som 42 hamnade aliaset på den äkta kandidatnyckeln och kunde skugga
// eller förfalska dess röster. Ett kanoniskt id har aldrig inledande nollor —
// det som inte går att skriva kanoniskt läses inte alls.
describe('aliased swipe doc ids cannot occupy the namespaced key (BIN-618)', () => {
  const movie42 = cand(42, [], 7, 'movie');
  const genuine = () => swipeFromDocId('movie_42', { a: 'yes', b: 'yes' });
  const score = (swipes: SessionSwipe[]) => scoreCandidates({
    candidates: [movie42],
    participants: [part('a'), part('b')],
    swipes,
  })[0];

  it('an alias id parses to NaN, so it can never name a candidate', () => {
    expect(Number.isNaN(parseTmdbIdFromDocId('movie_042'))).toBe(true);
    expect(Number.isNaN(parseTmdbIdFromDocId('042'))).toBe(true);
    expect(Number.isNaN(parseTmdbIdFromDocId('tv_0000042'))).toBe(true);
    // Okänt prefix är ett alias för det LEGACY-bara id:t på samma sätt.
    expect(Number.isNaN(parseTmdbIdFromDocId('zmovie_42'))).toBe(true);
    expect(Number.isNaN(parseTmdbIdFromDocId('season_42'))).toBe(true);
    // Kanoniska id fortsätter läsas — regeln får inte svälja äkta dokument.
    expect(parseTmdbIdFromDocId('movie_42')).toBe(42);
    expect(parseTmdbIdFromDocId('tv_42')).toBe(42);
    expect(parseTmdbIdFromDocId('42')).toBe(42);
  });

  it('an unknown-prefix alias cannot displace a genuine legacy bare-id doc', () => {
    const r = score([
      swipeFromDocId('42', { a: 'yes', b: 'yes' }),
      swipeFromDocId('zmovie_42', { a: 'no', b: 'no' }),
    ]);
    expect([r.yesCount, r.noCount]).toEqual([2, 0]);
  });

  it('an aliased doc read after the genuine one does not overwrite its votes', () => {
    const r = score([genuine(), swipeFromDocId('movie_042', { a: 'no', b: 'no' })]);
    expect([r.yesCount, r.noCount]).toEqual([2, 0]);
    expect(r.votes).toEqual({ a: 'yes', b: 'yes' });
  });

  it('an aliased doc alone forges nothing — no votes, no veto', () => {
    const r = score([swipeFromDocId('movie_042', { a: 'yes', b: 'veto' })]);
    expect([r.yesCount, r.noCount]).toEqual([0, 0]);
    expect(r.vetoed).toBe(false);
    expect(r.missing).toEqual(['a', 'b']);
  });

  // `c` röstar BARA i alias-doc:et — annars skulle den äkta rösten skriva över
  // den i värde-mergen (BIN-608) och testet inte kunna se skillnad.
  it('a bare legacy alias is not merged in as the legacy doc for 42 either', () => {
    const r = scoreCandidates({
      candidates: [movie42],
      participants: [part('a'), part('b'), part('c')],
      swipes: [swipeFromDocId('042', { c: 'veto' }), genuine()],
    })[0];
    expect(r.vetoed).toBe(false);
    expect(r.yesCount).toBe(2);
    expect(r.missing).toEqual(['c']);
  });

  it('an alias leaves the title unswiped rather than counting as progress', () => {
    const swipes = [swipeFromDocId('movie_042', { a: 'yes' })];
    expect(nextCandidate({ candidates: [movie42], swipes, participantId: 'a' })?.tmdbId).toBe(42);
    expect(participantSwipeProgress(swipes, [movie42], 'a')).toEqual({ done: 0, total: 1 });
  });
});
