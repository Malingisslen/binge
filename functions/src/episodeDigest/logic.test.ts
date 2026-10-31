import { describe, it, expect } from 'vitest';
import {
  groupQueueByUser, settlePending, alreadyWatched, onePerShow, allAiredYesterday, digestTitle, digestBody, episodeCode,
  type DigestItem,
} from './logic';

const item = (tmdbId: number, title: string, season: number, episode: number, airDate: string | null = '2026-10-30'): DigestItem =>
  ({ tmdbId, title, season, episode, airDate });

describe('groupQueueByUser', () => {
  it('collects every show a user is queued for', () => {
    const m = groupQueueByUser([
      { tmdbId: 1, pending: [{ episodeId: 11, season: 1, episode: 2, airDate: null, uids: ['a', 'b'] }] },
      { tmdbId: 2, pending: [{ episodeId: 22, season: 3, episode: 4, airDate: null, uids: ['a'] }] },
    ]);
    expect(m.get('a')).toHaveLength(2);
    expect(m.get('b')).toHaveLength(1);
  });
  it('does not list the same episode twice for one user', () => {
    const e = { episodeId: 11, season: 1, episode: 2, airDate: null, uids: ['a'] };
    const m = groupQueueByUser([{ tmdbId: 1, pending: [e, e] }]);
    expect(m.get('a')).toHaveLength(1);
  });
  it('keeps two different episodes of one show for one user', () => {
    const m = groupQueueByUser([{ tmdbId: 1, pending: [
      { episodeId: 11, season: 1, episode: 1, airDate: null, uids: ['a'] },
      { episodeId: 12, season: 1, episode: 2, airDate: null, uids: ['a'] },
    ] }]);
    expect(m.get('a')).toHaveLength(2);
  });
});

describe('alreadyWatched', () => {
  it('is false when nothing is logged', () => {
    expect(alreadyWatched({ lastWatchedSeason: null, lastWatchedEpisode: null }, 1, 1)).toBe(false);
  });
  it('is true at the same or a later episode, false before', () => {
    expect(alreadyWatched({ lastWatchedSeason: 2, lastWatchedEpisode: 5 }, 2, 5)).toBe(true);
    expect(alreadyWatched({ lastWatchedSeason: 3, lastWatchedEpisode: 1 }, 2, 9)).toBe(true);
    expect(alreadyWatched({ lastWatchedSeason: 2, lastWatchedEpisode: 4 }, 2, 5)).toBe(false);
  });
});

describe('onePerShow', () => {
  it('keeps the latest episode per show and sorts by title', () => {
    const out = onePerShow([item(2, 'Zebra', 1, 1), item(1, 'Andor', 1, 2), item(1, 'Andor', 1, 3)]);
    expect(out.map((i) => `${i.title}${i.episode}`)).toEqual(['Andor3', 'Zebra1']);
  });
  it('ranks season before episode, whatever the input order', () => {
    const out = onePerShow([item(1, 'Andor', 2, 1), item(1, 'Andor', 1, 9)]);
    expect(out).toEqual([item(1, 'Andor', 2, 1)]);
    expect(onePerShow([item(1, 'Andor', 1, 9), item(1, 'Andor', 2, 1)])).toEqual([item(1, 'Andor', 2, 1)]);
  });
});

describe('wording', () => {
  it('says Igår only when everything aired yesterday', () => {
    expect(allAiredYesterday([item(1, 'A', 1, 1, '2026-10-30')], '2026-10-30')).toBe(true);
    expect(allAiredYesterday([item(1, 'A', 1, 1, '2026-10-30'), item(2, 'B', 1, 1, '2026-10-29')], '2026-10-30')).toBe(false);
    expect(allAiredYesterday([item(1, 'A', 1, 1, null)], '2026-10-30')).toBe(false);
    expect(allAiredYesterday([], '2026-10-30')).toBe(false);
  });
  it('title counts only what is listed', () => {
    expect(digestTitle(3, true)).toBe('Igår kom 3 avsnitt du följer');
    expect(digestTitle(1, true)).toBe('Igår kom ett avsnitt du följer');
    expect(digestTitle(2, false)).toBe('2 nya avsnitt av serier du följer');
    expect(digestTitle(1, false)).toBe('Nytt avsnitt av en serie du följer');
  });
  it('body names series and code only and folds the rest', () => {
    const items = [item(1, 'Andor', 2, 1), item(2, 'Bear', 3, 4), item(3, 'Cobra', 1, 1), item(4, 'Dune', 1, 2)];
    expect(digestBody(items)).toBe('Andor S02E01, Bear S03E04, Cobra S01E01 och 1 till');
    expect(digestBody(items.slice(0, 1))).toBe('Andor S02E01');
    expect(digestBody(items.slice(0, 3))).toBe('Andor S02E01, Bear S03E04, Cobra S01E01');
    expect(episodeCode(1, 2)).toBe('S01E02');
  });
});

describe('settlePending', () => {
  const ep = (episodeId: number, uids: string[], queuedAt?: number) => ({ episodeId, season: 1, episode: episodeId, airDate: null, uids, queuedAt });
  it('removes only finished uids from entries it read', () => {
    const out = settlePending([ep(1, ['a', 'b'])], new Set([1]), new Set(['a']), 0);
    expect(out).toEqual([ep(1, ['b'])]);
  });
  it('drops an entry once everyone is finished', () => {
    expect(settlePending([ep(1, ['a'])], new Set([1]), new Set(['a']), 0)).toEqual([]);
  });
  it('keeps an entry queued while the run was going', () => {
    const out = settlePending([ep(1, ['a']), ep(2, ['a'])], new Set([1]), new Set(['a']), 0);
    expect(out).toEqual([ep(2, ['a'])]);
  });
  it('drops entries older than three days', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(settlePending([ep(1, ['a'], 0)], new Set(), new Set(), 4 * day)).toEqual([]);
    expect(settlePending([ep(1, ['a'], 0)], new Set(), new Set(), 2 * day)).toHaveLength(1);
  });
  it('age limit is exactly three days: at it kept, one ms past dropped, no queuedAt kept', () => {
    const limit = 3 * 24 * 60 * 60 * 1000;
    expect(settlePending([ep(1, ['a'], 0)], new Set(), new Set(), limit)).toHaveLength(1);
    expect(settlePending([ep(1, ['a'], 0)], new Set(), new Set(), limit + 1)).toEqual([]);
    expect(settlePending([ep(1, ['a'])], new Set(), new Set(), limit * 100)).toHaveLength(1);
  });
  it('keeps a user who failed (not in done) on an entry it read', () => {
    const out = settlePending([ep(1, ['a', 'b'])], new Set([1]), new Set(['a']), 0);
    expect(out[0].uids).toEqual(['b']);
    expect(settlePending([ep(1, ['a'])], new Set([1]), new Set(), 0)).toEqual([ep(1, ['a'])]);
  });
});
