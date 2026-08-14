import { describe, it, expect } from 'vitest';
import { selectCompanionAnchors, companionFilmKeys, COMPANION_FILM_CAP } from './companionSeeds';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import { librarySubState } from '@/lib/libraryView';
import type { WatchlistItem } from '@/types';

// Real curated ids (src/lib/franchise/companions.ts):
//   Breaking Bad tv/1396 → El Camino movie/559969
//   Arkiv X       tv/4087 → movie/846, movie/8836
//   Downton Abbey tv/33907 → movie/535544, 820446, 1289936
//   Firefly       tv/1437 → Serenity movie/16320

function mkItem(overrides: Partial<WatchlistItem>): WatchlistItem {
  return {
    tmdbId: 1,
    mediaType: 'tv',
    status: 'mina',
    rating: null,
    notes: null,
    title: 'Test',
    posterPath: null,
    releaseYear: 2020,
    totalSeasons: null,
    lastWatchedSeason: null,
    lastWatchedEpisode: null,
    dropped: false,
    rewatchCount: 0,
    providers: [],
    subscriptionProviders: null, providersCheckedAt: null,
    visibility: null,
    genreIds: [18],
    tmdbStatus: null,
    addedAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    watchedAt: null,
    ...overrides,
  };
}

const breakingBad = (o: Partial<WatchlistItem> = {}) =>
  mkItem({ tmdbId: 1396, title: 'Breaking Bad', ...o });

describe('selectCompanionAnchors', () => {
  it('offers the curated follow-up film for a followed show', () => {
    const anchors = selectCompanionAnchors([breakingBad()]);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].showTmdbId).toBe(1396);
    expect(anchors[0].showTitle).toBe('Breaking Bad');
    expect(anchors[0].films.map(f => f.id)).toEqual([559969]);
  });

  it('offers FILMS only — the source show of a group is never recommended back', () => {
    // Anchoring on a film's own group must not yield the tv entry as a "film".
    const anchors = selectCompanionAnchors([
      mkItem({ tmdbId: 4087, title: 'Arkiv X' }),
    ]);
    expect(anchors[0].films.every(f => f.mediaType === 'movie')).toBe(true);
    expect(anchors[0].films.map(f => f.id)).toEqual([846, 8836]);
  });

  it('emits nothing for an unmapped show — the row only exists when it has content', () => {
    expect(selectCompanionAnchors([mkItem({ tmdbId: 99999999, title: 'Okänd' })])).toEqual([]);
  });

  it('ignores shows the user does not follow (only status "mina" anchors)', () => {
    for (const status of ['vill_se', 'sedd', 'avbruten'] as const) {
      expect(selectCompanionAnchors([breakingBad({ status })])).toEqual([]);
    }
  });

  it('ignores movies with the same tmdbId as a mapped show (BIN-560 scoping)', () => {
    expect(selectCompanionAnchors([
      mkItem({ tmdbId: 1396, mediaType: 'movie', title: 'Not Breaking Bad' }),
    ])).toEqual([]);
  });

  it('drops a film already in the library, whatever its status', () => {
    const withElCamino = (status: WatchlistItem['status']) => selectCompanionAnchors([
      breakingBad(),
      mkItem({ tmdbId: 559969, mediaType: 'movie', title: 'El Camino', status }),
    ]);
    expect(withElCamino('sedd')).toEqual([]);
    expect(withElCamino('vill_se')).toEqual([]);
  });

  it('drops only the library film, keeping the rest of the group', () => {
    const anchors = selectCompanionAnchors([
      mkItem({ tmdbId: 4087, title: 'Arkiv X' }),
      mkItem({ tmdbId: 846, mediaType: 'movie', title: 'Fight the Future', status: 'sedd' }),
    ]);
    expect(anchors[0].films.map(f => f.id)).toEqual([8836]);
  });

  it('sorts anchors by show title so the row is independent of watchlist order', () => {
    const items = [
      mkItem({ tmdbId: 33907, title: 'Downton Abbey' }),
      breakingBad(),
      mkItem({ tmdbId: 1437, title: 'Firefly' }),
    ];
    const forward = selectCompanionAnchors(items).map(a => a.showTitle);
    const reversed = selectCompanionAnchors([...items].reverse()).map(a => a.showTitle);
    expect(forward).toEqual(['Breaking Bad', 'Downton Abbey', 'Firefly']);
    expect(reversed).toEqual(forward);
  });

  it('caps the total fan-out at COMPANION_FILM_CAP films', () => {
    // 1 + 2 + 3 + 1 = 7 curated films across four groups; assert the cap is what
    // bounds a larger set, not the (currently small) curated map.
    const anchors = selectCompanionAnchors([
      breakingBad(),
      mkItem({ tmdbId: 4087, title: 'Arkiv X' }),
      mkItem({ tmdbId: 33907, title: 'Downton Abbey' }),
      mkItem({ tmdbId: 1437, title: 'Firefly' }),
    ]);
    const total = anchors.reduce((n, a) => n + a.films.length, 0);
    expect(total).toBeLessThanOrEqual(COMPANION_FILM_CAP);
    expect(total).toBe(7);
  });

  it('never offers the same film twice across anchors', () => {
    const anchors = selectCompanionAnchors([
      breakingBad(),
      mkItem({ tmdbId: 4087, title: 'Arkiv X' }),
      mkItem({ tmdbId: 33907, title: 'Downton Abbey' }),
    ]);
    const ids = anchors.flatMap(a => a.films.map(f => f.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('companionFilmKeys', () => {
  it('returns composite movie keys for every offered film (cross-row dedup input)', () => {
    const anchors = selectCompanionAnchors([
      breakingBad(),
      mkItem({ tmdbId: 4087, title: 'Arkiv X' }),
    ]);
    expect(companionFilmKeys(anchors)).toEqual(new Set([
      mediaTypeDocId('movie', 559969),
      mediaTypeDocId('movie', 846),
      mediaTypeDocId('movie', 8836),
    ]));
  });

  it('is empty when there are no anchors', () => {
    expect(companionFilmKeys([]).size).toBe(0);
  });
});


describe('selectCompanionAnchors — WHY each show anchors the row (BIN-811)', () => {
  // The distinction Malin's option (c) is made of. It is NOT a widening: a series
  // never leaves `mina` when you finish it, so these shows already anchored the row
  // — they were just described as ones the user "follows".
  const ENDED = { tmdbStatus: 'Ended', totalSeasons: 5 };

  it("says 'following' for a show still being watched", () => {
    const anchors = selectCompanionAnchors([
      breakingBad({ tmdbStatus: 'Returning Series', totalSeasons: 5, lastWatchedSeason: 2 }),
    ]);
    expect(anchors[0].reason).toBe('following');
  });

  it("says 'finished' for a show the user has watched to the end", () => {
    const anchors = selectCompanionAnchors([
      breakingBad({ ...ENDED, lastWatchedSeason: 5, lastWatchedEpisode: 16 }),
    ]);
    expect(anchors[0].reason).toBe('finished');
  });

  it("says 'following' when the user is BEHIND on an ended show", () => {
    // 'ligger_efter', not 'avslutad' — the show is over but the user is not done
    // with it, and "du har sett klart" would be a lie about their own progress.
    const anchors = selectCompanionAnchors([
      breakingBad({ ...ENDED, lastWatchedSeason: 2 }),
    ]);
    expect(anchors[0].reason).toBe('following');
  });

  it("says 'following' for an ENDED show that was never started", () => {
    // 'ej_paborjad'. The film is still a legitimate suggestion; calling it
    // "sett klart" would be the over-claim this field exists to avoid.
    const anchors = selectCompanionAnchors([breakingBad(ENDED)]);
    expect(anchors[0].reason).toBe('following');
  });

  it('under-claims rather than over-claims when the backfill never ran', () => {
    // The known limitation, pinned so a future change cannot quietly invert it:
    // a finished show whose tmdbStatus/totalSeasons were never lazy-backfilled has
    // no way to be recognised, and answers 'following'. Safe direction — the row
    // can never call an airing show done.
    const anchors = selectCompanionAnchors([
      breakingBad({ tmdbStatus: null, totalSeasons: null, lastWatchedSeason: 5 }),
    ]);
    expect(anchors[0].reason).toBe('following');
  });

  it('labels each anchor on its own, and does not reorder them', () => {
    // Both halves matter. Per-anchor because one label for the whole row is what
    // (b) would have been; the sort because the film budget is spent in sort order,
    // so grouping by reason would change WHICH films an over-budget user is offered.
    const anchors = selectCompanionAnchors([
      breakingBad({ ...ENDED, lastWatchedSeason: 5 }),
      mkItem({ tmdbId: 1437, title: 'Firefly', lastWatchedSeason: 1 }),
      mkItem({ tmdbId: 4087, title: 'Arkiv X', lastWatchedSeason: 3 }),
    ]);

    expect(anchors.map(a => [a.showTitle, a.reason])).toEqual([
      ['Arkiv X', 'following'],
      ['Breaking Bad', 'finished'],
      ['Firefly', 'following'],
    ]);
  });

  it('answers from the item ALONE — no advisor state can change the label', () => {
    // librarySubState takes two optional live arguments the Streaming advisor
    // supplies (`knownBehind`, `knownEndedCaughtUp`), and passing them would make
    // the row's copy depend on whether an unrelated surface had loaded.
    //
    // Calling the selector twice would only prove determinism, which any pure
    // function has — a tautology (test review, 2026-08-14). What is actually
    // testable is the DIFFERENCE: `knownEndedCaughtUp` is exactly the signal that
    // turns a show with no persisted status into 'avslutad'. So take the one item
    // the advisor WOULD label finished, and assert this row does not.
    const advisorWouldSayFinished = breakingBad({
      tmdbStatus: null,
      totalSeasons: null,
      lastWatchedSeason: 5,
    });
    expect(librarySubState(advisorWouldSayFinished, false, true)).toBe('avslutad');
    expect(selectCompanionAnchors([advisorWouldSayFinished])[0].reason).toBe('following');
  });
});
