import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SHARED_FILTERS,
  countSharedFilters,
  formatStars,
  passesLength,
  passesProviders,
  passesYear,
  sanitizeSharedFilters,
  sharedFilterChips,
  starsFromTmdb,
  tmdbVoteFloor,
  wantedProviderIds,
  withoutEmptyMine,
} from './titleFilters';

describe('starsFromTmdb', () => {
  it('turns a 0–10 score into five stars in half steps', () => {
    expect(starsFromTmdb(7.4)).toBe(3.5);
    expect(starsFromTmdb(6.4)).toBe(3);
    expect(starsFromTmdb(6.5)).toBe(3.5);   // .25 star rounds up
    expect(starsFromTmdb(9.6)).toBe(5);
    expect(starsFromTmdb(0)).toBe(0);
    expect(starsFromTmdb(undefined)).toBe(0);
  });

  it('the TMDB floor keeps every score whose stars reach the threshold, and none below', () => {
    for (const m of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
      const floor = tmdbVoteFloor(m)!;
      for (let v10 = 0; v10 <= 100; v10++) {
        const v = v10 / 10;
        expect(v >= floor, `m=${m} v=${v}`).toBe(starsFromTmdb(v) >= m);
      }
    }
    expect(tmdbVoteFloor(0)).toBeNull();
  });
});

describe('formatStars', () => {
  it('writes halves with a Swedish comma', () => {
    expect(formatStars(3.5)).toBe('3,5');
    expect(formatStars(4)).toBe('4');
  });
});

describe('passesYear', () => {
  it('open bounds do not filter, and a title with no year fails once a bound is set', () => {
    expect(passesYear(null, null, null)).toBe(true);
    expect(passesYear(null, 1990, null)).toBe(false);
    expect(passesYear(1990, 1990, 1990)).toBe(true);
    expect(passesYear(1989, 1990, null)).toBe(false);
    expect(passesYear(2001, null, 2000)).toBe(false);
  });
});

describe('passesLength', () => {
  it('film lengths are inclusive upper bounds and only apply to films', () => {
    expect(passesLength('movie', 89, 'film-90')).toBe(true);
    expect(passesLength('movie', 90, 'film-90')).toBe(true);
    expect(passesLength('movie', 91, 'film-90')).toBe(false);
    expect(passesLength('movie', 120, 'film-120')).toBe(true);
    expect(passesLength('movie', 121, 'film-120')).toBe(false);
    expect(passesLength('tv', 20, 'film-90')).toBe(false);
  });
  it('short episodes are series with episodes of at most 30 minutes', () => {
    expect(passesLength('tv', 22, 'short-episodes')).toBe(true);
    expect(passesLength('tv', 30, 'short-episodes')).toBe(true);
    expect(passesLength('tv', 31, 'short-episodes')).toBe(false);
    expect(passesLength('movie', 22, 'short-episodes')).toBe(false);
  });
  it('an unknown runtime fails while a length is chosen and passes when none is', () => {
    expect(passesLength('movie', null, 'film-120')).toBe(false);
    expect(passesLength('movie', null, '')).toBe(true);
  });
});

describe('wantedProviderIds', () => {
  it('Mina tjänster is your services, canonicalised; without any it filters nothing', () => {
    expect(wantedProviderIds({ availability: 'mine', services: [] }, [8, 1944])).toEqual([8, 489]);
    expect(wantedProviderIds({ availability: 'mine', services: [] }, [])).toBeNull();
  });
  it('Specifik tjänst with nothing picked filters nothing', () => {
    expect(wantedProviderIds({ availability: 'specific', services: [] }, [8])).toBeNull();
    expect(wantedProviderIds({ availability: 'specific', services: [76, 8] }, [])).toEqual([76, 8]);
  });
  it('Alla never filters', () => {
    expect(wantedProviderIds({ availability: 'all', services: [76] }, [8])).toBeNull();
  });
});

describe('passesProviders', () => {
  it('matches on any wanted service across alias ids', () => {
    expect(passesProviders([1944], [489])).toBe(true);
    expect(passesProviders([8], [76, 337])).toBe(false);
    expect(passesProviders([], null)).toBe(true);
  });
});

describe('sharedFilterChips', () => {
  const name = (id: number) => ({ 8: 'Netflix', 76: 'Viaplay' } as Record<number, string>)[id] ?? '?';

  it('lists each active axis and each chip clears only its own axis', () => {
    const f = {
      ...DEFAULT_SHARED_FILTERS,
      availability: 'specific' as const, services: [8, 76],
      genres: ['35'], length: 'film-90' as const, yearMin: 1990, yearMax: 1999, minStars: 3.5,
    };
    const chips = sharedFilterChips(f, name);
    expect(chips.map(c => c.label)).toEqual([
      'Netflix eller Viaplay', 'Komedi', 'Film högst 90 min', 'År 1990–1999', '3,5★ eller mer',
    ]);
    const afterGenre = chips[1].clear(f);
    expect(afterGenre).toEqual({ ...f, genres: [] });
    expect(countSharedFilters(f)).toBe(5);
    expect(countSharedFilters(DEFAULT_SHARED_FILTERS)).toBe(0);
  });

  it('an open-ended year range says which end is set', () => {
    expect(sharedFilterChips({ ...DEFAULT_SHARED_FILTERS, yearMin: 2010 }, name)[0].label).toBe('Från 2010');
    expect(sharedFilterChips({ ...DEFAULT_SHARED_FILTERS, yearMax: 1980 }, name)[0].label).toBe('Till 1980');
  });
});

describe('sanitizeSharedFilters', () => {
  it('drops what does not fit, per axis', () => {
    expect(sanitizeSharedFilters({
      genres: ['35', 'nope', 7], availability: 'weird', services: [8, -1, 'x'],
      length: 'film-999', yearMin: 2010.5, yearMax: 'x', minStars: 3.3,
    })).toEqual({ ...DEFAULT_SHARED_FILTERS, genres: ['35'], services: [8] });
    expect(sanitizeSharedFilters(null)).toEqual(DEFAULT_SHARED_FILTERS);
  });
  it('swaps a reversed year range instead of emptying the list', () => {
    expect(sanitizeSharedFilters({ yearMin: 2000, yearMax: 1990 })).toMatchObject({ yearMin: 1990, yearMax: 2000 });
  });
});

describe('withoutEmptyMine', () => {
  it('reads a saved "Mina tjänster" as Alla once the user has no services, and leaves it otherwise', () => {
    const f = { ...DEFAULT_SHARED_FILTERS, availability: 'mine' as const };
    expect(withoutEmptyMine(f, []).availability).toBe('all');
    expect(withoutEmptyMine(f, [8])).toBe(f);
    expect(countSharedFilters(withoutEmptyMine(f, []))).toBe(0);
  });
});
