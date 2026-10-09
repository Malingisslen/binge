import { describe, it, expect } from 'vitest';
import {
  librarySubState,
  libraryProgressLabel,
  seenEpisodeCode,
  buildStandfirst,
  itemPassesLibraryFilters,
  genreOptionsInLibrary,
  serviceCountsInLibrary,
  sanitizeLibraryFilters,
  DEFAULT_LIBRARY_FILTERS,
  itemPassesTags,
  tagsInLibrary,
  LIBRARY_SUB_STATE_ORDER,
  LIBRARY_SECTION_LABELS,
} from './libraryView';
import type { WatchlistItem } from '@/types';

function makeItem(overrides: Partial<WatchlistItem>): WatchlistItem {
  return {
    tmdbId: 1, mediaType: 'tv', status: 'mina', rating: null, notes: null,
    title: 'X', posterPath: null, releaseYear: null, totalSeasons: null,
    lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false,
    rewatchCount: 0, providers: [], subscriptionProviders: null, providersCheckedAt: null, visibility: null,
    genreIds: [], tmdbStatus: null,
    addedAt: new Date(), updatedAt: new Date(), watchedAt: null,
    ...overrides,
  };
}

// === librarySubState — persisted-fields-only-kontraktet (B7/T2) ===
//
// Vad som PÅSTÅS:
//  - 'ej_paborjad'  — säkert (ingen progress sparad)
//  - 'ligger_efter' — bara när det är säkert: knownBehind (riktig aired-data)
//    eller Ended/Canceled + bakom sista kända säsongen
//  - 'avslutad'     — Ended/Canceled + inne i sista kända säsongen
//  - 'paborjad'     — ärligt obestämt: påbörjad, men ikapp-vs-efter går inte
//    att avgöra utan aired-data → vi påstår ingetdera
describe('librarySubState', () => {
  it('returns ej_paborjad when no progress is persisted', () => {
    expect(librarySubState(makeItem({}))).toBe('ej_paborjad');
    expect(librarySubState(makeItem({ tmdbStatus: 'Returning Series' }))).toBe('ej_paborjad');
    expect(librarySubState(makeItem({ tmdbStatus: 'Ended', totalSeasons: 3 }))).toBe('ej_paborjad');
  });

  it('never claims ligger_efter for a show that has not been started, even with knownBehind', () => {
    // Defensiv: advisorns behind-set kräver progress, men gå inte sönder om
    // flaggan ändå sätts för en ostartad titel.
    expect(librarySubState(makeItem({}), true)).toBe('ej_paborjad');
  });

  it('returns ligger_efter when knownBehind (verifierad mot aired-data) and started', () => {
    const item = makeItem({ lastWatchedSeason: 2, lastWatchedEpisode: 3, tmdbStatus: 'Returning Series' });
    expect(librarySubState(item, true)).toBe('ligger_efter');
  });

  it('returns ligger_efter when show ended and user is behind the last known season (certain — everything has aired)', () => {
    const item = makeItem({ lastWatchedSeason: 2, lastWatchedEpisode: 8, totalSeasons: 5, tmdbStatus: 'Ended' });
    expect(librarySubState(item)).toBe('ligger_efter');
  });

  it('returns ligger_efter for Canceled shows behind on seasons', () => {
    const item = makeItem({ lastWatchedSeason: 1, lastWatchedEpisode: 1, totalSeasons: 2, tmdbStatus: 'Canceled' });
    expect(librarySubState(item)).toBe('ligger_efter');
  });

  it('treats season 0 (Specials) as started — behind on an ended show counts as ligger_efter', () => {
    const item = makeItem({ lastWatchedSeason: 0, lastWatchedEpisode: 2, totalSeasons: 1, tmdbStatus: 'Ended' });
    expect(librarySubState(item)).toBe('ligger_efter');
  });

  it('returns avslutad when show ended and user reached the last known season', () => {
    const item = makeItem({ lastWatchedSeason: 5, lastWatchedEpisode: 10, totalSeasons: 5, tmdbStatus: 'Ended' });
    expect(librarySubState(item)).toBe('avslutad');
    const canceled = makeItem({ lastWatchedSeason: 1, lastWatchedEpisode: 6, totalSeasons: 1, tmdbStatus: 'Canceled' });
    expect(librarySubState(canceled)).toBe('avslutad');
  });

  it('returns paborjad (underdetermined) for ended shows when totalSeasons is unknown', () => {
    const item = makeItem({ lastWatchedSeason: 3, lastWatchedEpisode: 1, tmdbStatus: 'Ended', totalSeasons: null });
    expect(librarySubState(item)).toBe('paborjad');
  });

  it('returns paborjad for started Returning Series — caught-up vs behind is unknowable from persisted fields (Silo-fallet, T2)', () => {
    // Silo: S2E10 sedd, inget mer har sänts → tidigare felmärkt "Ligger efter · S2"
    const silo = makeItem({ lastWatchedSeason: 2, lastWatchedEpisode: 10, totalSeasons: 2, tmdbStatus: 'Returning Series' });
    expect(librarySubState(silo)).toBe('paborjad');
    // Även "bakom på säsonger" för Returning är obestämt — totalSeasons kan
    // inkludera en annonserad men ännu inte sänd säsong.
    const behindMaybe = makeItem({ lastWatchedSeason: 1, lastWatchedEpisode: 1, totalSeasons: 3, tmdbStatus: 'Returning Series' });
    expect(librarySubState(behindMaybe)).toBe('paborjad');
  });

  it('returns paborjad when tmdbStatus is missing (never lazily refreshed)', () => {
    const item = makeItem({ lastWatchedSeason: 1, lastWatchedEpisode: 4, tmdbStatus: null, totalSeasons: 2 });
    expect(librarySubState(item)).toBe('paborjad');
  });

  // === knownEndedCaughtUp — rådgivarens redan hämtade aired-data (root-fix) ===
  // En avslutad serie du är ikapp på ska landa i 'avslutad', inte i catch-all
  // 'paborjad' — även när tmdbStatus/totalSeasons aldrig lazy-backfillats.
  it('returns avslutad when advisor confirms caught-up + ended, even with no persisted tmdbStatus/totalSeasons', () => {
    const item = makeItem({ lastWatchedSeason: 3, lastWatchedEpisode: 8, tmdbStatus: null, totalSeasons: null });
    expect(librarySubState(item, false, true)).toBe('avslutad');
  });

  it('knownBehind wins over knownEndedCaughtUp (mutually exclusive live signals, defensive)', () => {
    const item = makeItem({ lastWatchedSeason: 2, lastWatchedEpisode: 3 });
    expect(librarySubState(item, true, true)).toBe('ligger_efter');
  });

  it('never claims avslutad for an unstarted show even with knownEndedCaughtUp', () => {
    expect(librarySubState(makeItem({}), false, true)).toBe('ej_paborjad');
  });
});

describe('LIBRARY_SUB_STATE_ORDER + LIBRARY_SECTION_LABELS', () => {
  it('orders sections most-actionable first and labels them in Swedish', () => {
    expect(LIBRARY_SUB_STATE_ORDER).toEqual(['ligger_efter', 'paborjad', 'ej_paborjad', 'avslutad']);
    expect(LIBRARY_SECTION_LABELS).toEqual({
      ligger_efter: 'Ligger efter',
      paborjad: 'Påbörjade',
      ej_paborjad: 'Ej påbörjade',
      avslutad: 'Avslutade',
    });
  });
});

describe('seenEpisodeCode', () => {
  it('returns null when nothing watched', () => {
    expect(seenEpisodeCode(makeItem({}))).toBeNull();
  });
  it('returns SxEy when both persisted', () => {
    expect(seenEpisodeCode(makeItem({ lastWatchedSeason: 2, lastWatchedEpisode: 10 }))).toBe('S02E10');
  });
  it('returns Sx when only season persisted', () => {
    expect(seenEpisodeCode(makeItem({ lastWatchedSeason: 3 }))).toBe('S03');
  });
  it('handles season 0 (Specials)', () => {
    expect(seenEpisodeCode(makeItem({ lastWatchedSeason: 0, lastWatchedEpisode: 2 }))).toBe('S00E02');
  });
});

// === libraryProgressLabel — exhaustiva, ärliga kortetiketter (B2) ===
describe('libraryProgressLabel', () => {
  it('avslutad → "Avslutad" (done)', () => {
    const item = makeItem({ lastWatchedSeason: 5, totalSeasons: 5, tmdbStatus: 'Ended' });
    expect(libraryProgressLabel(item, 'avslutad', null)).toEqual({ text: 'Avslutad', tone: 'done' });
  });

  it('ej_paborjad → "Ej påbörjad" (muted), never a bare "—"', () => {
    expect(libraryProgressLabel(makeItem({}), 'ej_paborjad', null)).toEqual({ text: 'Ej påbörjad', tone: 'muted' });
  });

  it('ligger_efter → claims behind + states what was seen', () => {
    const item = makeItem({ lastWatchedSeason: 2, lastWatchedEpisode: 8 });
    expect(libraryProgressLabel(item, 'ligger_efter', null)).toEqual({ text: 'Ligger efter · S02E08 sedd', tone: 'accent' });
  });

  it('ligger_efter without persisted progress (defensive) still labels honestly', () => {
    expect(libraryProgressLabel(makeItem({}), 'ligger_efter', null)).toEqual({ text: 'Ligger efter', tone: 'accent' });
  });

  it('paborjad → states only what we know: seen episode code, no behind/ikapp claim', () => {
    const item = makeItem({ lastWatchedSeason: 2, lastWatchedEpisode: 10 });
    expect(libraryProgressLabel(item, 'paborjad', null)).toEqual({ text: 'S02E10 sedd', tone: 'muted' });
  });

  it('paborjad with upcoming air date → "Nytt {dag}"', () => {
    const item = makeItem({ lastWatchedSeason: 2, lastWatchedEpisode: 10 });
    expect(libraryProgressLabel(item, 'paborjad', 'ons')).toEqual({ text: 'Nytt ons', tone: 'accent' });
  });
});

// === buildStandfirst — pluralisering (B5) + en källa för räknare (B1) ===
describe('buildStandfirst', () => {
  it('uses singular "titel" for exactly one visible title (B5)', () => {
    expect(buildStandfirst(1, 1, 'mina', 'all')).toBe('1 titel i denna lista.');
  });

  it('uses plural for multiple titles', () => {
    expect(buildStandfirst(194, 194, 'mina', 'all')).toBe('194 titlar i denna lista.');
  });

  it('says "X av Y" when filters hide some titles (search → 1 match, B5-reprot)', () => {
    expect(buildStandfirst(1, 194, 'mina', 'all')).toBe('1 av 194 titlar visas. Filtrera mer eller justera vyn.');
  });

  it('pluralizes per media filter', () => {
    expect(buildStandfirst(1, 1, 'vill_se', 'tv')).toBe('1 serie i denna lista.');
    expect(buildStandfirst(1, 1, 'vill_se', 'movie')).toBe('1 film i denna lista.');
    expect(buildStandfirst(2, 2, 'vill_se', 'movie')).toBe('2 filmer i denna lista.');
  });

  it('says "biblioteket" when no status (the /my/all view)', () => {
    expect(buildStandfirst(5, 5, undefined, 'all')).toBe('5 titlar i biblioteket.');
  });

  it('handles empty library and empty filter results', () => {
    expect(buildStandfirst(0, 0, 'mina', 'all')).toBe('Inget i biblioteket än. Hitta något att titta på via Rekommendationer.');
    expect(buildStandfirst(0, 10, 'mina', 'all')).toBe('Inga titlar matchar dina filter. Justera ovan eller rensa.');
  });

  it('names the empty tab, not the library, when other tabs have titles', () => {
    expect(buildStandfirst(0, 0, 'avbruten', 'all', 3)).toBe('Inget avbrutet än.');
    expect(buildStandfirst(0, 0, 'avbruten', 'all', 0)).toBe('Inget i biblioteket än. Hitta något att titta på via Rekommendationer.');
  });
});

describe('itemPassesLibraryFilters', () => {
  const F = DEFAULT_LIBRARY_FILTERS;
  const ctx = (o: Partial<{ genreIds: number[]; wantedProviders: number[] | null; runtime: number | null }> = {}) =>
    ({ genreIds: [], wantedProviders: null, runtime: null, ...o });

  it('no filters → passes everything', () => {
    expect(itemPassesLibraryFilters(makeItem({ genreIds: [], rating: null }), F, ctx())).toBe(true);
  });
  it('genre is OR-match (item has at least one selected genre)', () => {
    const item = makeItem({ genreIds: [18, 35] }); // Drama, Komedi
    expect(itemPassesLibraryFilters(item, F, ctx({ genreIds: [35] }))).toBe(true);
    expect(itemPassesLibraryFilters(item, F, ctx({ genreIds: [28] }))).toBe(false);
    expect(itemPassesLibraryFilters(item, F, ctx({ genreIds: [28, 18] }))).toBe(true);
  });
  it('lowest rating is in half stars and excludes lower or unrated', () => {
    const at = (minStars: number, rating: number | null) =>
      itemPassesLibraryFilters(makeItem({ rating }), { ...F, minStars }, ctx());
    expect(at(3, 4)).toBe(true);
    expect(at(3, 3)).toBe(true); // boundary inclusive
    expect(at(3, 2.5)).toBe(false);
    expect(at(3, null)).toBe(false);
    expect(at(3.5, 3.5)).toBe(true);
    expect(at(3.5, 3)).toBe(false);
  });
  it('combines genre AND rating', () => {
    const item = makeItem({ genreIds: [18], rating: 4 });
    expect(itemPassesLibraryFilters(item, { ...F, minStars: 3 }, ctx({ genreIds: [18] }))).toBe(true);
    expect(itemPassesLibraryFilters(item, { ...F, minStars: 4.5 }, ctx({ genreIds: [18] }))).toBe(false);
    expect(itemPassesLibraryFilters(item, { ...F, minStars: 3 }, ctx({ genreIds: [28] }))).toBe(false);
  });
  it('availability reads subscription offers, and falls back to every offer on an old doc', () => {
    const rentOnlyNetflix = makeItem({ providers: [8, 76], subscriptionProviders: [76] });
    expect(itemPassesLibraryFilters(rentOnlyNetflix, F, ctx({ wantedProviders: [8] }))).toBe(false);
    expect(itemPassesLibraryFilters(rentOnlyNetflix, F, ctx({ wantedProviders: [76] }))).toBe(true);
    const oldDoc = makeItem({ providers: [8], subscriptionProviders: null });
    expect(itemPassesLibraryFilters(oldDoc, F, ctx({ wantedProviders: [8] }))).toBe(true);
  });
  it('tags narrow through the combined filter too', () => {
    const tagged = makeItem({ tags: ['Mys'] });
    expect(itemPassesLibraryFilters(tagged, { ...F, tags: ['mys'] }, ctx())).toBe(true);
    expect(itemPassesLibraryFilters(tagged, { ...F, tags: ['Skräck'] }, ctx())).toBe(false);
  });
  it('a title checked and found on no subscription does not fall back to rent-and-buy offers', () => {
    const rentOnly = makeItem({ providers: [8], subscriptionProviders: [] });
    expect(itemPassesLibraryFilters(rentOnly, F, ctx({ wantedProviders: [8] }))).toBe(false);
  });
  it('status, year and length each narrow on their own', () => {
    const film = makeItem({ mediaType: 'movie', status: 'sedd', releaseYear: 1995 });
    expect(itemPassesLibraryFilters(film, { ...F, status: 'vill_se' }, ctx())).toBe(false);
    expect(itemPassesLibraryFilters(film, { ...F, status: 'sedd' }, ctx())).toBe(true);
    expect(itemPassesLibraryFilters(film, { ...F, yearMin: 1990, yearMax: 1999 }, ctx())).toBe(true);
    expect(itemPassesLibraryFilters(film, { ...F, yearMin: 2000 }, ctx())).toBe(false);
    expect(itemPassesLibraryFilters(film, { ...F, runtimeMax: 120 }, ctx({ runtime: 97 }))).toBe(true);
    expect(itemPassesLibraryFilters(film, { ...F, runtimeMax: 90 }, ctx({ runtime: 97 }))).toBe(false);
    expect(itemPassesLibraryFilters(film, { ...F, runtimeMin: 100 }, ctx({ runtime: 97 }))).toBe(false);
    expect(itemPassesLibraryFilters(film, { ...F, runtimeMax: 120 }, ctx({ runtime: null }))).toBe(false);
  });
});

describe('genreOptionsInLibrary', () => {
  it('offers only the shared Swedish options whose genres occur, in the shared order', () => {
    const items = [
      makeItem({ genreIds: [35, 18] }),   // Komedi, Drama
      makeItem({ genreIds: [10759] }),    // series Action & äventyr → Action and Äventyr
    ];
    expect(genreOptionsInLibrary(items).map(g => g.label)).toEqual(['Action', 'Drama', 'Komedi', 'Äventyr']);
  });
  it('returns [] for empty library', () => {
    expect(genreOptionsInLibrary([])).toEqual([]);
  });
});

describe('serviceCountsInLibrary', () => {
  const names: Record<number, string> = { 8: 'Netflix', 76: 'Viaplay', 489: 'TV4 Play' };
  it('counts each title once per service, canonicalising aliases, most first', () => {
    const items = [
      makeItem({ subscriptionProviders: [8, 76] }),
      makeItem({ subscriptionProviders: [76] }),
      makeItem({ subscriptionProviders: [1944, 489] }), // TV4 Play twice under two ids
      makeItem({ subscriptionProviders: [99999] }),     // unknown service: not offered
    ];
    expect(serviceCountsInLibrary(items, id => names[id])).toEqual([
      { id: 76, name: 'Viaplay', count: 2 },
      { id: 8, name: 'Netflix', count: 1 },
      { id: 489, name: 'TV4 Play', count: 1 },
    ]);
  });
});

describe('sanitizeLibraryFilters', () => {
  it('a stored value from another build falls back per axis', () => {
    expect(sanitizeLibraryFilters({ status: 'bogus', tags: ['a', 3], minStars: 3.3, yearMin: 2010, yearMax: 1990, genres: ['35', 'x'] }))
      .toEqual({ ...DEFAULT_LIBRARY_FILTERS, tags: ['a'], yearMin: 1990, yearMax: 2010, genres: ['35'] });
    expect(sanitizeLibraryFilters('garbage')).toEqual(DEFAULT_LIBRARY_FILTERS);
  });
});

// === Taggfilter (BIN-164) ===
describe('itemPassesTags', () => {
  it('passes everything when no tags are selected', () => {
    expect(itemPassesTags(makeItem({ tags: [] }), [])).toBe(true);
    expect(itemPassesTags(makeItem({ tags: undefined }), [])).toBe(true);
  });

  it('OR-matches (title has at least one selected tag), like genre chips', () => {
    const item = makeItem({ tags: ['mysrys', 'med mamma'] });
    expect(itemPassesTags(item, ['mysrys'])).toBe(true);
    expect(itemPassesTags(item, ['oscar-bait', 'med mamma'])).toBe(true);
    expect(itemPassesTags(item, ['oscar-bait'])).toBe(false);
  });

  it('matches case-insensitively (sv-SE)', () => {
    const item = makeItem({ tags: ['Mysrys', 'Återkommande'] });
    expect(itemPassesTags(item, ['MYSRYS'])).toBe(true);
    expect(itemPassesTags(item, ['återkommande'])).toBe(true);
  });

  it('does not pass an untagged title when tags are selected', () => {
    expect(itemPassesTags(makeItem({ tags: undefined }), ['mysrys'])).toBe(false);
    expect(itemPassesTags(makeItem({ tags: [] }), ['mysrys'])).toBe(false);
  });
});

describe('tagsInLibrary', () => {
  it('dedups case-insensitively, keeps first-seen casing, sorts sv-SE', () => {
    const items = [
      makeItem({ tags: ['Mysrys', 'action'] }),
      makeItem({ tags: ['mysrys', 'Bra'] }),
      makeItem({ tags: undefined }),
    ];
    // "Åter" would sort after latin letters in Swedish collation.
    expect(tagsInLibrary(items)).toEqual(['action', 'Bra', 'Mysrys']);
  });

  it('returns [] for a library with no tags', () => {
    expect(tagsInLibrary([makeItem({}), makeItem({ tags: [] })])).toEqual([]);
  });
});
