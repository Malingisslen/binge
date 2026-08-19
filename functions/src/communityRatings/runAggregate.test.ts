// functions/src/communityRatings/runAggregate.test.ts
//
// BIN-766 — `aggregateDocId` alone, as a pure function.
//
// It lives here rather than only in `src/test/rules/community-ratings-orchestrator.test.ts`
// (which is where its four existing assertions sit) for one reason #7 QA made binding:
// that suite's `beforeAll` boots a real Firestore emulator, and none of these cases needs
// one. `runAggregate.ts` imports only `./logic` and `../shared/mediaTypeDocId` — no
// `firebase-admin` — so this file matches `vitest.config.ts`'s
// `functions/src/**/*.{test,spec}.ts` glob and runs under plain `npm test`, which gates
// both ci.yml and deploy.yml. Emulator cost paid only where an emulator is the point.
//
// Deviation recorded rather than hidden: #13 Data/Integrations asked for `aggregateDocId`
// to MOVE into `logic.ts` as a pure helper. It stays in `runAggregate.ts` because its two
// parameter types (`RatingEvent`, `AggregateLogger`) are declared there, and moving the
// function without them would make `logic.ts` import from `runAggregate.ts` while
// `runAggregate.ts` already imports from `logic.ts` — a cycle, to relocate one function.
// The shared goal of #13's and #7's conditions — a pure test with no emulator, run by
// `npm test` — is met by this file, which is the path #7 named.

import { describe, it, expect, vi } from 'vitest';
import { aggregateDocId, type RatingEvent, type AggregateLogger } from './runAggregate';

function logger(): AggregateLogger & { warn: ReturnType<typeof vi.fn> } {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
}

// The body carries no mediaType unless a case asks for one. That is load-bearing for the
// skip cases below, not tidiness: `aggregateDocId` has TWO ways to return null — the
// unknown-mediaType branch and BIN-766's new unparseable-id branch. A garbage namespaced
// id that also lacked a resolvable mediaType could exit through either, and a test that
// only asserted "returned null" would pass for the wrong reason. With no body mediaType,
// a NAMESPACED id resolves its type from the prefix, so the only remaining way out is the
// id guard — and each skip case below additionally asserts WHICH warning was logged.
function ev(watchlistDocId: string, mediaType?: string): RatingEvent {
  return {
    watchlistDocId,
    eventId: 'evt-1',
    before: null,
    after: mediaType === undefined ? { rating: 4 } : { rating: 4, mediaType },
  } as never;
}

describe('aggregateDocId — the numeric part is canonicalised, not trusted (BIN-766)', () => {
  it('a padded namespaced id lands on the REAL title, not an average of its own', () => {
    // The defect itself. Before BIN-766 this returned `movie_042` verbatim, so the
    // rating went into `titleRatingsAggregate/movie_042` — a document no title page
    // ever reads, split off from the genuine `movie_42`.
    expect(aggregateDocId(ev('movie_042'), logger())).toBe('movie_42');
    expect(aggregateDocId(ev('tv_0000042'), logger())).toBe('tv_42');
  });

  it('an already-canonical id is unchanged', () => {
    // Asserted alongside the case above, not on its own. A fix that returned `null`
    // for every namespaced id would satisfy "movie_042 is not movie_042" while
    // breaking every real rating in the app; only the pair rules that out.
    expect(aggregateDocId(ev('movie_42'), logger())).toBe('movie_42');
    expect(aggregateDocId(ev('tv_1399'), logger())).toBe('tv_1399');
  });

  it('the legacy bare-numeric branch canonicalises too — the same bug had two doors', () => {
    // `'042'` has no prefix, so the media type comes from the body. The id part still
    // comes from the PATH, which is what keeps a spoofed body mediaType from being able
    // to stuff a real aggregate — it can only mis-bucket this one doc's single vote.
    expect(aggregateDocId(ev('042', 'movie'), logger())).toBe('movie_42');
    expect(aggregateDocId(ev('603', 'movie'), logger())).toBe('movie_603');
    expect(aggregateDocId(ev('1399', 'tv'), logger())).toBe('tv_1399');
  });

  it.each([
    ['movie_', 'empty suffix — Number("") is 0, so a naive finite-check writes movie_0'],
    ['movie_1_2', 'junk suffix — parseInt would return 1 and silently re-key it'],
    ['movie_xyz', 'non-numeric suffix'],
    ['tv_', 'empty suffix on the other prefix'],
  ])('skips %s with a warning and never writes movie_NaN (%s)', (docId) => {
    const log = logger();
    expect(aggregateDocId(ev(docId), log)).toBeNull();
    // Proves it exited through the ID guard and not the mediaType branch: each of these
    // carries a recognised prefix, so `parseMediaTypeFromDocId` resolved it and the
    // unknown-mediaType path was never reachable.
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toContain('unparseable tmdbId');
  });

  it('id 0 is skipped, not written — TMDB numbers titles from 1', () => {
    // BIN-646: `Number.isFinite(0)` used to let a phantom `movie_0` past every
    // downstream guard as if it named a title. `firestore.rules`' shape guard
    // deliberately still permits creating the DOC (matching the swipes residual,
    // BIN-797) — this is what stops it becoming a rating anyone counts.
    const log = logger();
    expect(aggregateDocId(ev('movie_0'), log)).toBeNull();
    expect(log.warn.mock.calls[0][0]).toContain('unparseable tmdbId');
  });

  it('a bare id with no resolvable mediaType is skipped through the OTHER branch', () => {
    // The pre-existing skip path, pinned so the two reasons for `null` stay
    // distinguishable. `'603'` parses fine as an id; what is missing is the type.
    const log = logger();
    expect(aggregateDocId(ev('603'), log)).toBeNull();
    expect(log.warn.mock.calls[0][0]).toContain('unknown mediaType');
  });

  it('a namespaced id ignores a contradicting body mediaType', () => {
    // The trust model, stated as a test rather than a comment: the prefix comes from the
    // path, which the owner cannot spoof without also owning that path.
    expect(aggregateDocId(ev('movie_42', 'tv'), logger())).toBe('movie_42');
  });
});
