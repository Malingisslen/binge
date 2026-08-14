// WHERE the companion row's reason actually renders (BIN-811).
//
// This test exists because the first version of BIN-811 shipped the sentence into
// `RowSpec.description` and stopped there, on the belief that `description` was the
// row's only rendered copy. It is not: the hub's row header renders `whyForRow`, and
// `description` reaches the screen only via RecommendationsExpanded's standfirst —
// behind "visa fler →". A user on /recommendations saw the same hardcoded line
// whether the anchor was one they follow or one they had finished, which is exactly
// option (b), the option Malin did not choose (integration review, 2026-08-14).
//
// So the property under test is not "the string is correct" — cascadePrioritizer's
// tests own that — it is "the row header uses it at all".

import { describe, it, expect } from 'vitest';
import { whyForRow } from './RecRow.helpers';
import { rowKey } from '@/types';
import type { RowSpec, RowId } from '@/types';

function spec(kind: RowId['kind'], description?: string): RowSpec {
  const id = { kind } as RowId;
  return { id, rowKey: rowKey(id), label: kind, score: 10, jtbd: 'C', ...(description ? { description } : {}) };
}

describe('whyForRow — the line the user reads in the row header', () => {
  it("uses the companion row's own sentence, not the generic one", () => {
    const sentence = 'Eftersom du följer Arkiv X, och har sett klart Breaking Bad.';
    expect(whyForRow(spec('companion', sentence))).toBe(sentence);
  });

  it('falls back to the generic line when a companion row carries no sentence', () => {
    // prioritizeRows always sets one today, so this is the belt not the braces —
    // but an empty header cell would be a worse failure than a generic line.
    expect(whyForRow(spec('companion'))).toBe('kurerad koppling · serien fortsätter som film');
  });

  it('does NOT hand any other row kind its description', () => {
    // Deliberately scoped. Every other row's why-line is a short, lowercase
    // fragment written for this slot; `description` is a full sentence written for
    // the expanded view's standfirst. Widening this would silently restyle eight
    // rows that nobody has designed for it.
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
      const withDescription = whyForRow(spec(kind, 'En helt annan mening.'));
      expect(withDescription).not.toBe('En helt annan mening.');
      // …and it is the same line it would have given with no description at all.
      expect(withDescription).toBe(whyForRow(spec(kind)));
    }
  });

  it('gives every row kind a non-empty line', () => {
    // The switch has no default. A new row kind added without a case would return
    // undefined and render an empty header cell — TypeScript catches that at the
    // switch, this catches it if someone adds a case that returns ''.
    for (const kind of [
      'trending',
      'latest-fav',
      'similar',
      'person',
      'genre-canon',
      'thematic',
      'upcoming',
      'free-public',
      'companion',
    ] as const) {
      expect(whyForRow(spec(kind)).length).toBeGreaterThan(0);
    }
  });
});
