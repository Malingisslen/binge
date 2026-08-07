import { describe, it, expect } from 'vitest';
import { selectCompanionAnchors, companionFilmKeys, COMPANION_FILM_CAP } from './companionSeeds';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
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
    providersCheckedAt: null,
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
