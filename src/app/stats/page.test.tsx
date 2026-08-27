import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// BIN-1027 — the "Sedd" tile counts MEMBERSHIP, not a date.
//
// BIN-1008 moved the rule into `src/lib/markedSeen.ts` and gave it a suite. It did not
// guard the three CALL SITES: swapping `markedSeen(items)` here back to
// `items.filter(i => seenDate(i) != null)` reddened nothing, because the helper's suite
// tests the helper.
//
// The rule and why it is the status rather than the date: `watchedAt` is stamped when a
// film is marked seen, and NOT cleared when it later leaves 'sedd' (the write is a merge).
// So a dropped film can carry a date, and a film the user marked seen from a surface that
// stamps no date has none. Counting dates gets both wrong, in both directions.

const items: unknown[] = [];
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => ({ items }) }));
// AuthGuard wraps the page and pulls the whole auth graph in; the tile is what is under
// test, so the guard is stubbed to render its children.
vi.mock('@/components/AuthGuard', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

import StatsPage from './page';

const title = (over: Record<string, unknown>) => ({
  tmdbId: 1,
  mediaType: 'movie',
  status: 'sedd',
  watchedAt: null,
  dropped: false,
  rating: null,
  tags: [],
  subscriptionProviders: [],
  ...over,
});

/** The number rendered in the StatCard labelled "Sedd". */
function seenTile(): string {
  const label = screen.getByText('Sedd');
  const card = label.closest('div')?.parentElement ?? label.parentElement!;
  return card.textContent!.replace('Sedd', '').trim();
}

beforeEach(() => { items.length = 0; });

describe('Statistik — the Sedd tile (BIN-1027)', () => {
  it('counts a sedd film that has no watchedAt', () => {
    // The decisive case, and the one a date filter drops.
    items.push(title({ tmdbId: 42, watchedAt: null }));

    render(<StatsPage />);

    expect(seenTile()).toBe('1');
  });

  it('does not count a dropped film that still carries a stale date', () => {
    // The other direction. The merge write leaves `watchedAt` behind, so a date filter
    // counts a film the user explicitly stopped watching.
    items.push(title({ tmdbId: 43, status: 'avbruten', watchedAt: new Date('2026-08-01') }));

    render(<StatsPage />);

    expect(seenTile()).toBe('0');
  });

  it('control — an ordinary sedd film with a date still counts', () => {
    // Without this the two rows above would pass on a tile hard-wired to zero.
    items.push(title({ tmdbId: 44, watchedAt: new Date('2026-08-02') }));

    render(<StatsPage />);

    expect(seenTile()).toBe('1');
  });
});
