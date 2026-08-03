// src/components/title/CollectionSection.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CollectionSection from './CollectionSection';
import type { MediaType, WatchlistItem } from '@/types';

// The most destructive write in the app: "Lägg alla osedda i vill se" hard-writes
// status: 'vill_se' over up to ADD_UNSEEN_CAP (50) films in a loop. `status` is the
// one field no payload shape can protect (MoviePageClient says so out loud), so a
// 'sedd' film caught by it is silently demoted out of Dagbok/Statistik.
//
// The gate is therefore the ONLY defence, and it was gated on `loading` — which
// goes false in BOTH terminal states. On a dead listener `getItem` answers null for
// every title, so every film read as unseen and the button rendered, enabled, for
// the rest of the session. That is the state this file pins.

const watchlist = vi.hoisted(() => ({
  getItem: vi.fn<(mediaType: MediaType, tmdbId: number) => WatchlistItem | null>(() => null),
  // Typed so the payload assertion below can index the call — an untyped vi.fn()
  // gives `calls: [][]`, which makes `calls[0][0]` a type error rather than a
  // check of what was actually written.
  addItem: vi.fn<(payload: { tmdbId: number; status: string }) => Promise<void>>(async () => {}),
  // Mirrors the provider's own derivation. A literal would let a test claim a
  // state production cannot reach and make every assertion below vacuous.
  snapshotSettled: true,
  listenerFailed: false,
  get libraryKnown(): boolean { return this.snapshotSettled && !this.listenerFailed; },
}));
const collection = vi.hoisted(() => ({
  data: null as { name: string; parts: { id: number; title: string; release_date: string }[] } | null,
}));

// `uid` and `loading` are present, not omitted: the component keys signed-out on
// the auth VERDICT (uid), and an absent field would read as signed-out and quietly
// satisfy every gate below — the mutation this file exists to catch.
const auth = vi.hoisted(() => ({
  uid: 'u1' as string | null,
  loading: false,
  user: { myProviders: [] as number[] },
}));

vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useTMDB', () => ({ useCollection: () => collection }));
vi.mock('@tanstack/react-query', () => ({ useQueries: () => [] }));

const BULK = 'Lägg alla osedda i vill se';

function seen(tmdbId: number): WatchlistItem {
  return { tmdbId, mediaType: 'movie', status: 'sedd' } as WatchlistItem;
}

describe('CollectionSection — the bulk add is gated on a KNOWN library (BIN-596)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchlist.snapshotSettled = true;
    watchlist.listenerFailed = false;
    watchlist.getItem.mockReturnValue(null);
    auth.uid = 'u1';
    auth.loading = false;
    collection.data = {
      name: 'Matrix-samlingen',
      parts: [
        { id: 603, title: 'The Matrix', release_date: '1999-03-31' },
        { id: 604, title: 'The Matrix Reloaded', release_date: '2003-05-15' },
      ],
    };
  });

  it('offers the bulk add once the library is known', async () => {
    render(<CollectionSection collectionId={1} currentMovieId={603} />);
    // Sanity that the control exists at all — otherwise the negative cases below
    // would pass for the wrong reason (a component that renders nothing).
    expect(await screen.findByText(BULK)).toBeInTheDocument();
  });

  it('does NOT offer it while the first snapshot is still in flight', async () => {
    watchlist.snapshotSettled = false;
    render(<CollectionSection collectionId={1} currentMovieId={603} />);
    await act(async () => {});

    expect(screen.queryByText(BULK)).not.toBeInTheDocument();
    expect(watchlist.addItem).not.toHaveBeenCalled();
  });

  it('does NOT offer it when the listener has DIED — the state `loading` could not name', async () => {
    // The regression this test exists for. `loading` would be false here, and the
    // old gate read that as "library known, nothing in it".
    watchlist.snapshotSettled = true;
    watchlist.listenerFailed = true;
    render(<CollectionSection collectionId={1} currentMovieId={603} />);
    await act(async () => {});

    expect(screen.queryByText(BULK)).not.toBeInTheDocument();
    expect(watchlist.addItem).not.toHaveBeenCalled();
  });

  it('never counts a film the user has already SEEN as unseen', async () => {
    watchlist.getItem.mockImplementation((_t, id) => (id === 603 ? seen(603) : null));
    render(<CollectionSection collectionId={1} currentMovieId={603} />);

    await act(async () => { fireEvent.click(await screen.findByText(BULK)); });

    // Only the genuinely-unseen film is written; the 'sedd' one is untouched.
    expect(watchlist.addItem).toHaveBeenCalledTimes(1);
    expect(watchlist.addItem.mock.calls[0][0]).toMatchObject({ tmdbId: 604, status: 'vill_se' });
  });

  it('a SIGNED-OUT visitor still gets the read-only section — no listener ever runs for them', async () => {
    // `libraryKnown` is false forever when nobody is signed in (the provider
    // returns before subscribing), so gating the read-only half on it hid the
    // whole "Var streamar de osedda?" block from every logged-out visitor on an
    // acquisition surface. "Not in your library" is simply TRUE for them.
    auth.uid = null;
    watchlist.snapshotSettled = false;
    render(<CollectionSection collectionId={1} currentMovieId={603} />);
    await act(async () => {});

    expect(screen.getByText(/Var streamar de osedda/)).toBeInTheDocument();
    expect(screen.getByText(/0 av 2 sedda/)).toBeInTheDocument();
    // …but no bulk WRITE affordance: they cannot write, so offering it would be
    // the dead button this ticket exists to remove.
    expect(screen.queryByText(BULK)).not.toBeInTheDocument();
  });

  it('the seen/unseen count stays silent until the library is known', async () => {
    // A pre-settle count reads 0-of-N for everyone, which tells a user who has
    // seen the whole collection that they have seen none of it.
    watchlist.listenerFailed = true;
    render(<CollectionSection collectionId={1} currentMovieId={603} />);
    await act(async () => {});

    expect(screen.queryByText(/av 2 sedda/)).not.toBeInTheDocument();
  });
});
