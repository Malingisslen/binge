import { describe, it, expect } from 'vitest';
import { buildFilmDiary, buildDiary, flattenEpisodeProgress, diaryEntryCount } from './diary';
import type { WatchlistItem } from '@/types';

const mk = (over: Partial<WatchlistItem>): WatchlistItem => ({
  tmdbId: 1, mediaType: 'movie', status: 'sedd', rating: null, notes: null,
  title: 'X', posterPath: null, releaseYear: null, totalSeasons: null,
  lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false,
  rewatchCount: 0, providers: [], providersCheckedAt: null, visibility: null,
  genreIds: [], tmdbStatus: null,
  addedAt: new Date(), updatedAt: new Date(), watchedAt: null,
  ...over,
}) as WatchlistItem;

const ts = (iso: string) => ({ toDate: () => new Date(iso) });

describe('buildFilmDiary (BIN-103)', () => {
  it('includes only sedd films with a watchedAt, sorted newest-first', () => {
    const items = [
      mk({ tmdbId: 1, title: 'Old', watchedAt: new Date('2026-01-10T12:00:00') }),
      mk({ tmdbId: 2, title: 'New', watchedAt: new Date('2026-03-05T12:00:00') }),
      mk({ tmdbId: 3, title: 'No date', watchedAt: null }),                       // excluded (no date)
      mk({ tmdbId: 4, title: 'Want', status: 'vill_se', watchedAt: new Date('2026-02-01T12:00:00') }), // excluded (not sedd)
      mk({ tmdbId: 5, title: 'Series', mediaType: 'tv', watchedAt: new Date('2026-02-02T12:00:00') }), // excluded (tv)
    ];
    const months = buildFilmDiary(items);
    const flat = months.flatMap(m => m.entries.map(e => e.item.title));
    expect(flat).toEqual(['New', 'Old']); // newest first, only the two valid films
    expect(diaryEntryCount(months)).toBe(2);
  });

  it('groups by calendar month with a Swedish label', () => {
    const items = [
      mk({ tmdbId: 1, watchedAt: new Date('2026-03-20T12:00:00') }),
      mk({ tmdbId: 2, watchedAt: new Date('2026-03-02T12:00:00') }),
      mk({ tmdbId: 3, watchedAt: new Date('2026-01-15T12:00:00') }),
    ];
    const months = buildFilmDiary(items);
    expect(months.map(m => m.key)).toEqual(['2026-03', '2026-01']); // newest month first
    expect(months[0].label).toBe('mars 2026');
    expect(months[0].entries).toHaveLength(2); // both March films in one group
    expect(months[0].entries.map(e => e.item.tmdbId)).toEqual([1, 2]); // Mar-20 before Mar-02 (newest-first within month)
    expect(months[1].label).toBe('januari 2026');
  });

  it('returns an empty list when nothing qualifies', () => {
    expect(buildFilmDiary([mk({ status: 'vill_se', watchedAt: null })])).toEqual([]);
    expect(diaryEntryCount([])).toBe(0);
  });
});

describe('flattenEpisodeProgress (BIN-103)', () => {
  it('flattens watched episodes with real timestamps, skipping unwatched/corrupt', () => {
    const docs = [
      {
        id: '100', tmdbId: 100,
        seasons: {
          '1': {
            '1': { watched: true, watchedAt: ts('2026-02-10T20:00:00') },
            '2': { watched: false, watchedAt: null },                 // unwatched → skip
            '3': { watched: true, watchedAt: null },                  // no timestamp → skip
          },
          'seasons.1.5': { '5': { watched: true, watchedAt: ts('2026-02-11T20:00:00') } }, // corrupt key → skip
        },
      },
      { id: '200', seasons: { '2': { '4': { watched: true, watchedAt: ts('2026-02-12T20:00:00') } } } }, // tmdbId from id
      { id: 'junk', seasons: {} }, // non-numeric id, no episodes → contributes nothing
    ];
    const eps = flattenEpisodeProgress(docs);
    expect(eps).toEqual([
      { tmdbId: 100, season: 1, episode: 1, watchedAt: new Date('2026-02-10T20:00:00') },
      { tmdbId: 200, season: 2, episode: 4, watchedAt: new Date('2026-02-12T20:00:00') },
    ]);
  });
});

describe('buildDiary with episodes (BIN-103)', () => {
  it('merges films + episodes by date, looking up show metadata from the library', () => {
    const items = [
      mk({ tmdbId: 1, title: 'En film', watchedAt: new Date('2026-03-15T12:00:00') }),
      mk({ tmdbId: 100, title: 'En serie', mediaType: 'tv', status: 'mina', watchedAt: null }),
    ];
    const episodes = [
      { tmdbId: 100, season: 2, episode: 5, watchedAt: new Date('2026-03-20T20:00:00') }, // newer than the film
      { tmdbId: 999, season: 1, episode: 1, watchedAt: new Date('2026-03-25T20:00:00') }, // orphan (not in library) → skipped
    ];
    const months = buildDiary(items, episodes);
    expect(months).toHaveLength(1);
    expect(months[0].entries.map(e => [e.item.title, e.episodeCode])).toEqual([
      ['En serie', 'S2E5'], // newest first
      ['En film', null],
    ]);
    expect(diaryEntryCount(months)).toBe(2); // orphan episode excluded
  });
});
