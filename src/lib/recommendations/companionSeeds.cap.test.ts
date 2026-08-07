import { describe, it, expect, vi } from 'vitest';
import type { CompanionTitle } from '@/lib/franchise/companions';
import type { WatchlistItem } from '@/types';

// The sibling suite's cap test uses a four-show subset (7 films) and therefore only
// ever proves 7 <= 12 — it never reaches the truncation branch, and stayed green
// against a mutant that let the cap overshoot by 100. This file mocks the curated
// map with a synthetic set well past the cap so the per-anchor
// `films.length >= budget` cut is actually exercised, and stays exercised however
// the real map grows (binding condition from the #28 Recommendations /
// Scoring-Integrity critique, 2026-08-06).
//
// The real map is already past the cap in total, so the branch is reachable in
// production by a user following enough of the mapped shows. That fact is asserted
// in companions.test.ts rather than hand-counted here — two successive counts in
// this comment were wrong, and a prose count rots on the next append to the map.

const FILMS_PER_SHOW = 10;

function synthFilms(showId: number): CompanionTitle[] {
  return Array.from({ length: FILMS_PER_SHOW }, (_, i) => ({
    id: showId * 1000 + i,
    mediaType: 'movie' as const,
    label: `Film ${showId}-${i} (2020)`,
  }));
}

vi.mock('@/lib/franchise/companions', () => ({
  companionFilmsFor: vi.fn((mediaType: 'movie' | 'tv', tmdbId: number) =>
    mediaType === 'tv' ? synthFilms(tmdbId) : [],
  ),
}));

// Static imports are safe here: vi.mock is hoisted above them.
import { companionFilmsFor } from '@/lib/franchise/companions';
import { selectCompanionAnchors, COMPANION_FILM_CAP } from './companionSeeds';

function show(tmdbId: number, title: string): WatchlistItem {
  return {
    tmdbId,
    mediaType: 'tv',
    status: 'mina',
    rating: null,
    notes: null,
    title,
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
  };
}

describe('selectCompanionAnchors — cap truncation', () => {
  it('truncates the LAST anchor mid-list instead of overshooting the cap', () => {
    // 2 shows × 10 synthetic films = 20 available, cap is 12.
    const anchors = selectCompanionAnchors([show(1, 'Alfa'), show(2, 'Beta')]);
    const total = anchors.reduce((n, a) => n + a.films.length, 0);

    expect(total).toBe(COMPANION_FILM_CAP);
    expect(anchors[0].films).toHaveLength(FILMS_PER_SHOW);
    // the remaining budget, not a whole group
    expect(anchors[1].films).toHaveLength(COMPANION_FILM_CAP - FILMS_PER_SHOW);
  });

  it('stops emitting anchors once the budget is spent', () => {
    const anchors = selectCompanionAnchors([
      show(1, 'Alfa'),
      show(2, 'Beta'),
      show(3, 'Gamma'),
      show(4, 'Delta'),
    ]);

    expect(anchors.reduce((n, a) => n + a.films.length, 0)).toBe(COMPANION_FILM_CAP);
    // Alfa (10) + Beta (2) exhausts the cap; Gamma and Delta must not appear at all
    // rather than appear as empty rows.
    expect(anchors.map(a => a.showTitle)).toEqual(['Alfa', 'Beta']);
  });

  it('a single show cannot exceed the cap on its own', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: 9000 + i,
      mediaType: 'movie' as const,
      label: `Solo ${i} (2020)`,
    }));
    vi.mocked(companionFilmsFor).mockReturnValueOnce(many);

    const anchors = selectCompanionAnchors([show(7, 'Solo')]);
    expect(anchors[0].films).toHaveLength(COMPANION_FILM_CAP);
  });
});
