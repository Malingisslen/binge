import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SHARED_FILTERS,
  countSharedFilters,
  formatStars,
  passesRuntime,
  runtimeLabel,
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

describe('passesRuntime', () => {
  it('both bounds are inclusive, so a 90-minute film fits up to 90', () => {
    expect(passesRuntime(90, null, 90)).toBe(true);
    expect(passesRuntime(91, null, 90)).toBe(false);
    expect(passesRuntime(45, 45, 120)).toBe(true);
    expect(passesRuntime(44, 45, 120)).toBe(false);
    expect(passesRuntime(120, 45, 120)).toBe(true);
    expect(passesRuntime(121, 45, 120)).toBe(false);
  });
  it('films and episodes share one scale: a 22-minute episode fits up to 30', () => {
    expect(passesRuntime(22, null, 30)).toBe(true);
  });
  it('an open end lets everything past it through', () => {
    expect(passesRuntime(200, 60, null)).toBe(true);
    expect(passesRuntime(59, 60, null)).toBe(false);
  });
  it('an unknown runtime fails while a bound is set and passes when none is', () => {
    expect(passesRuntime(null, null, 120)).toBe(false);
    expect(passesRuntime(0, 10, null)).toBe(false);
    expect(passesRuntime(null, null, null)).toBe(true);
  });
});

describe('runtimeLabel', () => {
  it('names the range the way the chip shows it', () => {
    expect(runtimeLabel(null, null)).toBe('Alla längder');
    expect(runtimeLabel(45, 120)).toBe('45–120 min');
    expect(runtimeLabel(null, 90)).toBe('Högst 90 min');
    expect(runtimeLabel(60, null)).toBe('Minst 60 min');
    expect(runtimeLabel(30, 30)).toBe('30 min');
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
      genres: ['35'], runtimeMin: 45, runtimeMax: 120, yearMin: 1990, yearMax: 1999, minStars: 3.5,
    };
    const chips = sharedFilterChips(f, name);
    expect(chips.map(c => c.label)).toEqual([
      'Netflix eller Viaplay', 'Komedi', '45–120 min', 'År 1990–1999', '3,5★ eller mer',
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
      runtimeMin: 0, runtimeMax: 999, yearMin: 2010.5, yearMax: 'x', minStars: 3.3,
    })).toEqual({ ...DEFAULT_SHARED_FILTERS, genres: ['35'], services: [8] });
    expect(sanitizeSharedFilters(null)).toEqual(DEFAULT_SHARED_FILTERS);
  });
  it('a length chosen before the slider carries over as the upper bound it meant', () => {
    expect(sanitizeSharedFilters({ length: 'film-90' })).toMatchObject({ runtimeMin: null, runtimeMax: 90 });
    expect(sanitizeSharedFilters({ length: 'film-120' })).toMatchObject({ runtimeMax: 120 });
    expect(sanitizeSharedFilters({ length: 'short-episodes' })).toMatchObject({ runtimeMax: 30 });
    expect(sanitizeSharedFilters({ length: 'film-90', runtimeMin: 60 })).toMatchObject({ runtimeMin: 60, runtimeMax: null });
  });
  it('a runtime end the slider can set reads back, including a lower bound at the top stop', () => {
    expect(sanitizeSharedFilters({ runtimeMin: 180 })).toMatchObject({ runtimeMin: 180, runtimeMax: null });
    expect(sanitizeSharedFilters({ runtimeMax: 0 })).toMatchObject({ runtimeMin: null, runtimeMax: 0 });
    expect(sanitizeSharedFilters({ runtimeMin: 0, runtimeMax: 180 })).toMatchObject({ runtimeMin: null, runtimeMax: null });
  });
  it('swaps a reversed runtime range', () => {
    expect(sanitizeSharedFilters({ runtimeMin: 120, runtimeMax: 45 })).toMatchObject({ runtimeMin: 45, runtimeMax: 120 });
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
