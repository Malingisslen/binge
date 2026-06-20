import { describe, it, expect } from 'vitest';
import {
  librarySubState,
  libraryProgressLabel,
  seenEpisodeCode,
  buildStandfirst,
  itemPassesGenreRating,
  genresInLibrary,
  LIBRARY_SUB_STATE_ORDER,
  LIBRARY_SECTION_LABELS,
} from './libraryView';
import type { WatchlistItem } from '@/types';

function makeItem(overrides: Partial<WatchlistItem>): WatchlistItem {
  return {
    tmdbId: 1, mediaType: 'tv', status: 'mina', rating: null, notes: null,
    title: 'X', posterPath: null, releaseYear: null, totalSeasons: null,
    lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false,
    rewatchCount: 0, providers: [], providersCheckedAt: null, visibility: null,
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
    expect(seenEpisodeCode(makeItem({ lastWatchedSeason: 2, lastWatchedEpisode: 10 }))).toBe('S2E10');
  });
  it('returns Sx when only season persisted', () => {
    expect(seenEpisodeCode(makeItem({ lastWatchedSeason: 3 }))).toBe('S3');
  });
  it('handles season 0 (Specials)', () => {
    expect(seenEpisodeCode(makeItem({ lastWatchedSeason: 0, lastWatchedEpisode: 2 }))).toBe('S0E2');
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
    expect(libraryProgressLabel(item, 'ligger_efter', null)).toEqual({ text: 'Ligger efter · S2E8 sedd', tone: 'accent' });
  });

  it('ligger_efter without persisted progress (defensive) still labels honestly', () => {
    expect(libraryProgressLabel(makeItem({}), 'ligger_efter', null)).toEqual({ text: 'Ligger efter', tone: 'accent' });
  });

  it('paborjad → states only what we know: seen episode code, no behind/ikapp claim', () => {
    const item = makeItem({ lastWatchedSeason: 2, lastWatchedEpisode: 10 });
    expect(libraryProgressLabel(item, 'paborjad', null)).toEqual({ text: 'S2E10 sedd', tone: 'muted' });
  });

  it('paborjad with upcoming air date → "Nytt {dag}"', () => {
    const item = makeItem({ lastWatchedSeason: 2, lastWatchedEpisode: 10 });
    expect(libraryProgressLabel(item, 'paborjad', 'ons')).toEqual({ text: 'Nytt ons', tone: 'accent' });
  });
});

// === buildStandfirst — pluralisering (B5) + en källa för räknare (B1) ===
describe('buildStandfirst', () => {
  it('uses singular "titel" for exactly one visible title (B5)', () => {
    expect(buildStandfirst(1, 1, 'mina', 'all')).toBe('1 titel i denna lista. Vi räknade åt dig.');
  });

  it('uses plural for multiple titles', () => {
    expect(buildStandfirst(194, 194, 'mina', 'all')).toBe('194 titlar i denna lista. Vi räknade åt dig.');
  });

  it('says "X av Y" when filters hide some titles (search → 1 match, B5-reprot)', () => {
    expect(buildStandfirst(1, 194, 'mina', 'all')).toBe('1 av 194 titlar visas. Filtrera mer eller justera vyn.');
  });

  it('pluralizes per media filter', () => {
    expect(buildStandfirst(1, 1, 'vill_se', 'tv')).toBe('1 serie i denna lista. Vi räknade åt dig.');
    expect(buildStandfirst(1, 1, 'vill_se', 'movie')).toBe('1 film i denna lista. Vi räknade åt dig.');
    expect(buildStandfirst(2, 2, 'vill_se', 'movie')).toBe('2 filmer i denna lista. Vi räknade åt dig.');
  });

  it('says "biblioteket" when no status (the /my/all view)', () => {
    expect(buildStandfirst(5, 5, undefined, 'all')).toBe('5 titlar i biblioteket. Vi räknade åt dig.');
  });

  it('handles empty library and empty filter results', () => {
    expect(buildStandfirst(0, 0, 'mina', 'all')).toBe('Inget i biblioteket än. Hitta något att titta på via Rekommendationer.');
    expect(buildStandfirst(0, 10, 'mina', 'all')).toBe('Inga titlar matchar dina filter. Justera ovan eller rensa.');
  });
});

describe('itemPassesGenreRating (BIN-44)', () => {
  it('no filters → passes everything', () => {
    expect(itemPassesGenreRating(makeItem({ genreIds: [], rating: null }), [], null)).toBe(true);
  });
  it('genre is OR-match (item has at least one selected genre)', () => {
    const item = makeItem({ genreIds: [18, 35] }); // Drama, Komedi
    expect(itemPassesGenreRating(item, [35], null)).toBe(true);   // matches Komedi
    expect(itemPassesGenreRating(item, [28], null)).toBe(false);  // no Action
    expect(itemPassesGenreRating(item, [28, 18], null)).toBe(true); // matches Drama
  });
  it('minRating excludes lower or unrated', () => {
    expect(itemPassesGenreRating(makeItem({ rating: 8 }), [], 7)).toBe(true);
    expect(itemPassesGenreRating(makeItem({ rating: 7 }), [], 7)).toBe(true); // boundary inclusive
    expect(itemPassesGenreRating(makeItem({ rating: 6 }), [], 7)).toBe(false);
    expect(itemPassesGenreRating(makeItem({ rating: null }), [], 7)).toBe(false);
  });
  it('combines genre AND rating', () => {
    const item = makeItem({ genreIds: [18], rating: 8 });
    expect(itemPassesGenreRating(item, [18], 7)).toBe(true);
    expect(itemPassesGenreRating(item, [18], 9)).toBe(false); // rating too low
    expect(itemPassesGenreRating(item, [28], 7)).toBe(false); // genre miss
  });
});

describe('genresInLibrary (BIN-44)', () => {
  it('dedupes genres present and sorts by Swedish name', () => {
    // Insertion order (35, 18, 28) deliberately differs from sorted order, so
    // the name assertion genuinely pins the sort (not just Set insertion order).
    const items = [
      makeItem({ genreIds: [35, 18] }), // Komedi, Drama
      makeItem({ genreIds: [28, 35] }), // Action, Komedi (dup)
    ];
    const res = genresInLibrary(items);
    expect(res.map(g => g.id).sort((a, b) => a - b)).toEqual([18, 28, 35]);
    // Sorted by Swedish name (not insertion order Komedi/Drama/Action): Action, Drama, Komedi
    expect(res.map(g => g.name)).toEqual(['Action', 'Drama', 'Komedi']);
  });
  it('returns [] for empty library', () => {
    expect(genresInLibrary([])).toEqual([]);
  });
});
