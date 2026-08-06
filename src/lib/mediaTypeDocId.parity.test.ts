import { describe, it, expect } from 'vitest';
import * as client from './mediaTypeDocId';
// functions/ has its own tsconfig and cannot import the `@/` client source, so the
// helper is a hand-copied mirror. Importing BOTH copies into one test is the only
// thing that can see them drift. Same technique as providerAliasParity.test.ts.
import * as server from '../../functions/src/shared/mediaTypeDocId';

/**
 * BIN-636 — the drift net for the deliberately HALF-diverged mediaTypeDocId pair.
 *
 * The WRITE side must stay byte-identical in behaviour: client and server key a
 * title's document identically or the two write to different documents.
 *
 * The READ side diverges on purpose since BIN-618: the client rejects aliased doc
 * ids (`movie_042`, `zmovie_42`, …) that would re-key onto a genuine title's slot
 * and shadow its contents; the server copy stays permissive because its read sites
 * were not audited (BIN-624, still open).
 *
 * Nothing else enforced that split, so a plausible "these two files should be
 * identical, resync them" cleanup could silently reopen the alias hole with the
 * suite still green. This file fails loudly on BOTH directions of that edit:
 * loosening the client fails the "client rejects" assertions, tightening the
 * server fails the "server still accepts" ones.
 *
 * WHEN THIS FILE GOES RED: that is the signal to decide, not to soften. If the
 * server was deliberately tightened, BIN-624 is what just shipped — audit the
 * server read sites listed on that ticket, then rewrite the divergence block below
 * as a plain agreement block. Never relax the client to make it pass.
 */

/**
 * The alias shapes BIN-618 closed on the client. Server still resolves all of these to 42.
 *
 * BIN-624 half 1 made this list load-bearing in a SECOND file: the swipe doc-id guard's
 * denial cases in `src/test/rules/firestore-rules.test.ts` are asserted to be a superset of
 * this array, so that a doc id the client refuses to READ can also never be WRITTEN. Nothing
 * mechanically links the two — if you add a shape here, add it there too, or the rules test
 * quietly stops being the superset its own comment claims.
 */
const ALIASES_OF_42 = ['movie_042', '042', 'tv_0000042', 'zmovie_42', 'season_42'] as const;

/** Doc ids both copies must still agree on — the non-diverged part of the read contract. */
const AGREED_READS: ReadonlyArray<[docId: string, expected: number]> = [
  ['123', 123], // legacy bare id
  ['movie_123', 123], // namespaced
  ['tv_123', 123],
  ['movie_42', 42], // the genuine key the aliases above collapse onto
  ['movie_', NaN], // empty suffix — must be NaN, never Number('') === 0
  ['_', NaN],
  ['', NaN],
  ['movie_1_2', NaN], // embedded underscore
  ['tv_xyz', NaN],
];

describe('mediaTypeDocId WRITE contract — the two copies must agree exactly', () => {
  it.each(['movie', 'tv', 'Movie', 'bogus', '', null, undefined])(
    'normalizeMediaType(%o) agrees across client and server',
    (raw) => {
      const expected = raw === 'movie' ? 'movie' : 'tv';
      expect(client.normalizeMediaType(raw)).toBe(expected);
      expect(server.normalizeMediaType(raw)).toBe(expected);
    },
  );

  it.each([
    ['movie', 42, 'movie_42'],
    ['tv', 42, 'tv_42'],
    ['movie', '42', 'movie_42'], // string path param passes through unrounded
    [undefined, 7, 'tv_7'],
    ['bogus', 7, 'tv_7'],
  ] as const)('mediaTypeDocId(%o, %o) is %s on both sides', (mediaType, tmdbId, expected) => {
    expect(client.mediaTypeDocId(mediaType, tmdbId)).toBe(expected);
    expect(server.mediaTypeDocId(mediaType, tmdbId)).toBe(expected);
  });

  it.each(['movie_123', 'tv_123', '123', '', 'season_5'])(
    'parseMediaTypeFromDocId(%o) agrees across client and server',
    (docId) => {
      expect(client.parseMediaTypeFromDocId(docId)).toBe(server.parseMediaTypeFromDocId(docId));
    },
  );
});

describe('mediaTypeDocId READ contract — agrees everywhere except the BIN-618 alias set', () => {
  it.each(AGREED_READS)('parseTmdbIdFromDocId(%o) is %o on both sides', (docId, expected) => {
    // Object.is(NaN, NaN) is true, so toBe covers the NaN rows without a helper.
    expect(client.parseTmdbIdFromDocId(docId)).toBe(expected);
    expect(server.parseTmdbIdFromDocId(docId)).toBe(expected);
  });

  it.each(AGREED_READS)('resolveTmdbId(null, %o) is %o on both sides', (docId, expected) => {
    expect(client.resolveTmdbId(null, docId)).toBe(expected);
    expect(server.resolveTmdbId(null, docId)).toBe(expected);
  });
});

describe('the BIN-618 client/server split is DELIBERATE — a resync must fail here (BIN-636)', () => {
  it.each(ALIASES_OF_42)('client REJECTS the aliased doc id %s', (docId) => {
    expect(client.parseTmdbIdFromDocId(docId)).toBe(NaN);
    // Field-less doc: the whole point is that it does not silently land on 42.
    expect(client.resolveTmdbId(null, docId)).toBe(NaN);
  });

  it.each(ALIASES_OF_42)('server STILL ACCEPTS %s and re-keys it onto the genuine 42', (docId) => {
    expect(server.parseTmdbIdFromDocId(docId)).toBe(42);
    expect(server.resolveTmdbId(null, docId)).toBe(42);
  });

  it('pins the shadowing this closes: the aliases and the real key are the same number server-side', () => {
    const genuine = server.parseTmdbIdFromDocId(server.mediaTypeDocId('movie', 42));
    for (const alias of ALIASES_OF_42) {
      expect(server.parseTmdbIdFromDocId(alias)).toBe(genuine);
    }
  });

  // BIN-646 came here and said so. The field branch used to be the way an
  // aliased doc could still resolve on the client: `Number('042')` is 42, so
  // `movie_042` was NaN without the field and 42 with it — readable or not for a
  // reason unrelated to which title it names. The client now holds a STRING
  // field to the same canonical shape as the doc id; the server still resolves
  // both, which is the BIN-618 split, unchanged.
  it('a stored "042" field no longer rescues an aliased doc on the client (BIN-646)', () => {
    expect(client.resolveTmdbId('042', 'movie_042')).toBe(NaN);
    expect(server.resolveTmdbId('042', 'movie_042')).toBe(42);
  });

  it('a NUMERIC field is untouched by that tightening — it cannot be spelled with a leading zero', () => {
    expect(client.resolveTmdbId(42, 'movie_042')).toBe(42);
    expect(server.resolveTmdbId(42, 'movie_042')).toBe(42);
  });

  // BIN-646, second half: id 0. TMDB numbers titles from 1, but Number.isFinite(0)
  // is true, so `movie_0` used to walk past every downstream guard as a real
  // title — the phantom-id-0 hole the empty suffix was already closed for. The
  // field branch has always required > 0; now the doc-id branch agrees.
  it.each(['0', 'movie_0', 'tv_0'])('client rejects the phantom id-0 doc %s', (docId) => {
    expect(client.parseTmdbIdFromDocId(docId)).toBe(NaN);
    expect(client.resolveTmdbId(null, docId)).toBe(NaN);
    // Both directions, per this file's own contract: tightening the SERVER copy
    // must fail here too, not just relaxing the client one.
    expect(server.parseTmdbIdFromDocId(docId)).toBe(0);
  });

  it('a zero FIELD was never accepted either — the two branches now agree on 0', () => {
    expect(client.resolveTmdbId(0, 'movie_0')).toBe(NaN);
    expect(client.resolveTmdbId('0', 'movie_0')).toBe(NaN);
  });
});
