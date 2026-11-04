import { describe, it, expect } from 'vitest';
import {
  buildHouseholdWatching,
  composeHouseholdContribution,
  contributionContentEquals,
  HOUSEHOLD_WATCHING_MAX,
  sanitizeHouseholdWatching,
  withoutHouseholdWatchingTitle,
  type HouseholdBaseContent,
} from './householdAggregate';
import type { WatchlistItem } from '@/types';

// ADR 0029: a household shares the titles each member is watching, never a private one.

type Row = Parameters<typeof buildHouseholdWatching>[0][number];
function row(over: Partial<WatchlistItem> = {}): Row {
  return {
    tmdbId: 1399, mediaType: 'tv', title: 'Severance', status: 'mina', dropped: false,
    visibility: null, lastWatchedEpisode: 3, updatedAt: new Date('2026-11-01T10:00:00Z'),
    ...over,
  };
}

describe('buildHouseholdWatching', () => {
  it('shares a started series with id, type and title only', () => {
    expect(buildHouseholdWatching([row()])).toEqual([{ id: 1399, type: 'tv', title: 'Severance' }]);
  });

  it('leaves out a title marked Privat', () => {
    expect(buildHouseholdWatching([row({ visibility: 'private' })])).toEqual([]);
  });

  it('keeps a title that only inherits a private profile default (ADR 0027 point 2)', () => {
    expect(buildHouseholdWatching([row({ visibility: null })])).toHaveLength(1);
  });

  it('leaves out series not started, dropped, finished or only wanted, and films', () => {
    expect(buildHouseholdWatching([
      row({ tmdbId: 1, lastWatchedEpisode: null }),
      row({ tmdbId: 2, dropped: true }),
      row({ tmdbId: 3, status: 'sedd' }),
      row({ tmdbId: 4, status: 'avbruten' }),
      row({ tmdbId: 5, mediaType: 'movie', status: 'mina' }),
      row({ tmdbId: 6, status: 'vill_se' }),
    ])).toEqual([]);
  });

  it('the cap is the number the rules enforce on watchingNow', () => {
    expect(HOUSEHOLD_WATCHING_MAX).toBe(10);
  });

  it('puts the most recently updated first and stops at the cap', () => {
    const rows = Array.from({ length: HOUSEHOLD_WATCHING_MAX + 2 }, (_, i) =>
      row({ tmdbId: i + 1, title: `T${i + 1}`, updatedAt: new Date(2026, 9, i + 1) }));
    const out = buildHouseholdWatching(rows);
    expect(out).toHaveLength(HOUSEHOLD_WATCHING_MAX);
    expect(out[0].id).toBe(HOUSEHOLD_WATCHING_MAX + 2);
    expect(out.map(t => t.id)).not.toContain(1);
    expect(out.map(t => t.id)).not.toContain(2);
  });
});

describe('sanitizeHouseholdWatching', () => {
  it('treats a stored value that is not a list as not shared', () => {
    expect(sanitizeHouseholdWatching('Severance')).toBeUndefined();
  });

  it('keeps at most the cap and clamps a long title', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, type: 'tv', title: 'x'.repeat(300) }));
    const out = sanitizeHouseholdWatching(many)!;
    expect(out).toHaveLength(HOUSEHOLD_WATCHING_MAX);
    expect(out[0].title).toHaveLength(200);
  });

  it('keeps a missing value undefined, so a member who has not shared stays unknown', () => {
    expect(sanitizeHouseholdWatching(undefined)).toBeUndefined();
  });

  it('drops entries the rules cannot check', () => {
    expect(sanitizeHouseholdWatching([
      { id: 1, type: 'tv', title: 'Ok' },
      { id: -1, type: 'tv', title: 'Bad id' },
      { id: 2, type: 'book', title: 'Bad type' },
      { id: 3, type: 'tv', title: '   ' },
      { id: 4, type: 'tv', title: 'x', rating: 9 },
      'Severance',
    ])).toEqual([{ id: 1, type: 'tv', title: 'Ok' }, { id: 4, type: 'tv', title: 'x' }]);
  });
});

describe('composeHouseholdContribution with titles', () => {
  const base: HouseholdBaseContent = { providerIds: [8], providerCosts: { 8: 169 }, providerCampaigns: {}, activeProviderIds: [8] };
  const watching = [{ id: 1399, type: 'tv' as const, title: 'Severance' }];
  const MONTH = '2026-11';

  it('writes no titles until the member shares under the household text', () => {
    const out = composeHouseholdContribution(base, { soonProviderIds: [] }, { monthKey: MONTH, soon: [], watching });
    expect(out.watchingNow).toBeUndefined();
  });

  it('writes titles on the Dela press in a household', () => {
    const out = composeHouseholdContribution(base, undefined, { monthKey: MONTH, soon: [], watching, optInWatching: true });
    expect(out.watchingNow).toEqual(watching);
  });

  it('a fresh list replaces the stored one, so a title made Privat leaves the data', () => {
    const b = { id: 2, type: 'tv' as const, title: 'The Bear' };
    const out = composeHouseholdContribution(base, { watchingNow: [...watching, b] }, { monthKey: MONTH, soon: null, watching });
    expect(out.watchingNow).toEqual(watching);
  });

  it('a fresh empty list replaces the stored one', () => {
    const out = composeHouseholdContribution(base, { watchingNow: watching }, { monthKey: MONTH, soon: null, watching: [] });
    expect(out.watchingNow).toEqual([]);
  });

  it('keeps the stored titles when the caller has no fresh list', () => {
    const out = composeHouseholdContribution(base, { watchingNow: watching }, { monthKey: MONTH, soon: null, watching: null });
    expect(out.watchingNow).toEqual(watching);
  });

  it('a changed title list counts as a change worth a write', () => {
    const a = { ...base, watchingNow: watching };
    expect(contributionContentEquals(a, { ...base, watchingNow: [] })).toBe(false);
    expect(contributionContentEquals(a, { ...base })).toBe(false);
    expect(contributionContentEquals(a, { ...base, watchingNow: [...watching] })).toBe(true);
  });
});

describe('withoutHouseholdWatchingTitle', () => {
  const list = [
    { id: 1, type: 'tv' as const, title: 'Severance' },
    { id: 1, type: 'movie' as const, title: 'Samma id, annan typ' },
  ];

  it('drops the matching title and keeps one of the same id but other type', () => {
    expect(withoutHouseholdWatchingTitle(list, 'tv', 1)).toEqual([list[1]]);
  });

  it('removing the only title gives an empty list, which is written', () => {
    expect(withoutHouseholdWatchingTitle([list[0]], 'tv', 1)).toEqual([]);
  });

  it('returns null when there is nothing to remove, so nothing is written', () => {
    expect(withoutHouseholdWatchingTitle(list, 'tv', 99)).toBeNull();
    expect(withoutHouseholdWatchingTitle(undefined, 'tv', 1)).toBeNull();
  });
});
