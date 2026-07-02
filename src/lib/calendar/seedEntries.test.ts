import { describe, expect, it } from 'vitest';
import { seedCalendarEntries } from './seedEntries';
import type { WatchlistItem } from '@/types';

const item = (over: Partial<WatchlistItem>): WatchlistItem => ({
  tmdbId: 1399, mediaType: 'tv', status: 'mina', rating: null, notes: null,
  title: 'Test', posterPath: '/p.jpg', releaseYear: null, totalSeasons: null,
  lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false,
  rewatchCount: 0, providers: [], providersCheckedAt: null, visibility: null,
  genreIds: [18], tmdbStatus: null, runtime: null,
  addedAt: new Date(0), updatedAt: new Date(0), watchedAt: null,
  ...over,
});

describe('seedCalendarEntries', () => {
  it('builds an episode entry from denormalized next-air fields', () => {
    const entries = seedCalendarEntries([item({
      nextAirDate: '2999-01-05', nextAirCode: 'S02E03', nextAirProvider: 'HBO Max',
    })]);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.kind).toBe('episode');
    expect(e.airDate).toBe('2999-01-05');
    if (e.kind === 'episode') {
      expect(e.season).toBe(2);
      expect(e.episode).toBe(3);
      expect(e.provider).toBe('HBO Max');
      expect(e.isPremiere).toBe(false);
    }
  });
  it('builds a movie entry from digitalReleaseDate (vill_se only)', () => {
    const entries = seedCalendarEntries([item({
      tmdbId: 603, mediaType: 'movie', status: 'vill_se', digitalReleaseDate: '2999-02-01',
    })]);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('movie');
    expect(entries[0].airDate).toBe('2999-02-01');
  });
  it('marks E01 as premiere', () => {
    const entries = seedCalendarEntries([item({ nextAirDate: '2999-01-05', nextAirCode: 'S03E01' })]);
    expect(entries[0].kind === 'episode' && entries[0].isPremiere).toBe(true);
  });
  it('includes today (airing tonight is the killer focal)', () => {
    const now = new Date('2026-07-02T12:00:00');
    const entries = seedCalendarEntries(
      [item({ nextAirDate: '2026-07-02', nextAirCode: 'S01E05' })],
      now,
    );
    expect(entries).toHaveLength(1);
  });
  it('skips past dates, unparsable codes, dropped items and unrepaired items', () => {
    expect(seedCalendarEntries([
      item({ nextAirDate: '2000-01-01', nextAirCode: 'S01E01' }),           // past
      item({ tmdbId: 2, nextAirDate: '2999-01-05', nextAirCode: 'kaos' }),  // unparsable
      item({ tmdbId: 3, nextAirDate: '2999-01-05', nextAirCode: 'S01E01', dropped: true }),
      item({ tmdbId: 4 }),                                                  // never repaired
      item({ tmdbId: 5, mediaType: 'movie', status: 'sedd', digitalReleaseDate: '2999-02-01' }), // wrong status
    ])).toHaveLength(0);
  });
});
