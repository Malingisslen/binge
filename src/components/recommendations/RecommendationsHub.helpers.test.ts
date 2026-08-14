// BIN-809 — the cross-row dedup rule, which shipped in BIN-583 with no test at all.
//
// The #28 panel made it a binding condition: a film already shown elsewhere on the
// page must not appear again in the companion row. `companionSeeds.test.ts` pinned
// only that the KEY LIST gets produced; nothing pinned that anything applies it.
// The two halves are separate and BOTH have to hold, so they are tested separately
// and then together:
//   1. the union is built  — other rows are handed the companion films as exclusions
//   2. the dispatch swaps  — the companion row is the ONE row handed the base set
// Break either and the film appears twice, or not at all.

import { describe, it, expect } from 'vitest';
import { excludedIdsForOtherRows, exclusionsForRow } from './RecommendationsHub.helpers';
import { dedupeAndExclude } from '@/lib/recommendations/rowComposition';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import { rowKey } from '@/types';
import type { RowSpec, RowId, RowTitle, CompanionAnchor } from '@/types';

const EL_CAMINO = 559969;
const SERENITY = 16320;

function anchor(showTitle: string, showTmdbId: number, filmIds: number[]): CompanionAnchor {
  return {
    showTmdbId,
    showTitle,
    reason: 'following',
    films: filmIds.map(id => ({ mediaType: 'movie' as const, id, label: `${showTitle}: filmen` })),
  };
}

function row(kind: RowId['kind'], companions?: CompanionAnchor[]): RowSpec {
  const id = { kind } as RowId;
  return {
    id,
    rowKey: rowKey(id),
    label: kind,
    score: 10,
    jtbd: 'C',
    ...(companions ? { meta: { companions } } : {}),
  };
}

function movie(id: number): RowTitle {
  return { id, media_type: 'movie', title: `Film ${id}` } as RowTitle;
}

describe('excludedIdsForOtherRows', () => {
  it("adds the companion row's films to what every other row must skip", () => {
    const base = new Set(['movie-111']);
    const result = excludedIdsForOtherRows(base, [
      row('similar'),
      row('companion', [anchor('Breaking Bad', 1396, [EL_CAMINO])]),
      row('trending'),
    ]);

    expect(result.has(mediaTypeDocId('movie', EL_CAMINO))).toBe(true);
    // …without losing what was already excluded (the user's own library).
    expect(result.has('movie-111')).toBe(true);
  });

  it('collects films from EVERY anchor, not just the first', () => {
    // The row carries one anchor per show and the budget is spent across all of
    // them, so a flatMap that stopped at [0] would leak the second show's film
    // into the similar row while the companion row also showed it.
    const result = excludedIdsForOtherRows(new Set(), [
      row('companion', [
        anchor('Breaking Bad', 1396, [EL_CAMINO]),
        anchor('Firefly', 1437, [SERENITY]),
      ]),
    ]);

    expect(result.has(mediaTypeDocId('movie', EL_CAMINO))).toBe(true);
    expect(result.has(mediaTypeDocId('movie', SERENITY))).toBe(true);
  });

  it('ignores companions hanging off a NON-companion row', () => {
    // meta.companions is typed as optional on every RowSpec. Reading it without
    // checking the kind would let an unrelated row suppress a title page-wide.
    const result = excludedIdsForOtherRows(new Set(), [
      { ...row('similar'), meta: { companions: [anchor('Breaking Bad', 1396, [EL_CAMINO])] } },
    ]);

    expect(result.has(mediaTypeDocId('movie', EL_CAMINO))).toBe(false);
  });

  it('returns the SAME set object when there is nothing to add', () => {
    // Identity, not just equality: the hub memoises on this value, so a fresh
    // Set every render would re-render every row on the page for nothing.
    const base = new Set(['movie-111']);
    expect(excludedIdsForOtherRows(base, [row('similar'), row('trending')])).toBe(base);
    // Same for a companion row that exists but has no films to claim.
    expect(excludedIdsForOtherRows(base, [row('companion', [anchor('X', 1, [])])])).toBe(base);
  });
});

describe('exclusionsForRow', () => {
  const base = new Set(['movie-1']);
  const wider = new Set(['movie-1', 'movie-2']);

  it('hands the companion row the base set — it is the row that keeps its films', () => {
    expect(exclusionsForRow('companion', base, wider)).toBe(base);
  });

  it('hands every other row the wider set', () => {
    for (const kind of [
      'trending',
      'latest-fav',
      'similar',
      'person',
      'genre-canon',
      'thematic',
      'upcoming',
      'free-public',
    ] as const) {
      expect(exclusionsForRow(kind, base, wider)).toBe(wider);
    }
  });
});

describe('the two halves together — a shared film renders exactly once', () => {
  it('the companion row keeps it and the similar row drops it', () => {
    // The end-to-end property BIN-809 asked for, driven through the real
    // composition helper the rows use rather than asserted on the sets.
    const library = new Set(['tv-1396']);
    const rows = [row('similar'), row('companion', [anchor('Breaking Bad', 1396, [EL_CAMINO])])];
    const otherRows = excludedIdsForOtherRows(library, rows);

    // Both rows happen to surface the same film — the case the #28 condition is about.
    const candidates = [movie(EL_CAMINO), movie(999)];

    const inCompanion = dedupeAndExclude(
      candidates,
      exclusionsForRow('companion', library, otherRows),
    );
    const inSimilar = dedupeAndExclude(
      candidates,
      exclusionsForRow('similar', library, otherRows),
    );

    expect(inCompanion.map(t => t.id)).toContain(EL_CAMINO);
    expect(inSimilar.map(t => t.id)).not.toContain(EL_CAMINO);
    // Exactly once across the page, and the unrelated title is untouched in both.
    expect(
      [...inCompanion, ...inSimilar].filter(t => t.id === EL_CAMINO),
    ).toHaveLength(1);
    expect(inSimilar.map(t => t.id)).toContain(999);
  });

  it('a film ALREADY in the library appears in neither row', () => {
    // The control. Without it the test above would pass just as well if the
    // companion row ignored exclusions altogether — which is a different bug
    // (a title the user already owns, offered back to them).
    const library = new Set([mediaTypeDocId('movie', EL_CAMINO)]);
    const rows = [row('companion', [anchor('Breaking Bad', 1396, [EL_CAMINO])])];
    const otherRows = excludedIdsForOtherRows(library, rows);

    expect(
      dedupeAndExclude([movie(EL_CAMINO)], exclusionsForRow('companion', library, otherRows)),
    ).toEqual([]);
    expect(
      dedupeAndExclude([movie(EL_CAMINO)], exclusionsForRow('similar', library, otherRows)),
    ).toEqual([]);
  });
});
