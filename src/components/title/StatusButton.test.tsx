// src/components/title/StatusButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import StatusButton from './StatusButton';
import { LIBRARY_UNAVAILABLE } from './libraryHold';
import type { MediaType, WatchlistItem } from '@/types';

// BIN-641 — "Sedd igen" is the ONLY thing in the app that counts a rewatch.
//
// Malin, 2026-07-31. The plain 'Sedd' option renders HIGHLIGHTED when it is
// already the title's status, so a tap on it is as likely to mean "confirm" or
// "dismiss the menu" as "I watched it again". `rewatchCount` is editable
// nowhere, so a count from that gesture would be permanent and wrong. Hence a
// distinct action, and hence these tests assert on the INTENT passed to
// markSeen — not merely that a write happened.

const watchlist = vi.hoisted(() => ({
  getItem: vi.fn<(mediaType: MediaType, tmdbId: number) => WatchlistItem | null>(() => null),
  addItem: vi.fn(),
  removeItem: vi.fn(),
  // BIN-596: the two readiness facts `loading` cannot express. Seeded to the
  // settled state so the BIN-641 cases below exercise a normal, usable button;
  // the BIN-596 block flips them.
  snapshotSettled: true,
  listenerFailed: false,
  // Derived exactly as the provider derives it, and as a getter: a fixed literal
  // would let a case set `listenerFailed` while still handing the component
  // `libraryKnown: true` — a state production cannot produce, which would make
  // every gate assertion below vacuous.
  get libraryKnown(): boolean { return this.snapshotSettled && !this.listenerFailed; },
}));
// BIN-596: mutable auth, so the gate can be driven from both sides. `user` is
// present because the real useAuth() returns it — keying the gate on the profile
// instead of `uid` is the bug BIN-645 caught in the sibling component, and an
// absent field here would let that mutation pass.
const auth = vi.hoisted(() => ({
  uid: 'u1' as string | null,
  user: null as { uid: string } | null,
  loading: false,
}));
const markSeen = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/hooks/useMarkSeen', () => ({ useMarkSeen: () => markSeen }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));
vi.mock('@/lib/firebase/episodeProgress', () => ({ clearEpisodeProgress: vi.fn() }));

const seenFilm = {
  tmdbId: 603, mediaType: 'movie', status: 'sedd', title: 'The Matrix', rating: 4,
} as WatchlistItem;

const film = () => (
  <StatusButton tmdbId={603} mediaType="movie" title="The Matrix" posterPath={null} releaseYear={1999} />
);
const series = () => (
  <StatusButton tmdbId={1399} mediaType="tv" title="Game of Thrones" posterPath={null} releaseYear={2011} />
);

const intentOfLastMarkSeen = () => markSeen.mock.calls.at(-1)![1]?.countsAsViewing ?? false;

describe('StatusButton — "Sedd igen" (BIN-641)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchlist.getItem.mockReturnValue(seenFilm);
    watchlist.snapshotSettled = true;
    watchlist.listenerFailed = false;
    auth.uid = 'u1';
    auth.user = { uid: 'u1' };
    auth.loading = false;
  });

  it('counts a rewatch when the user picks it', async () => {
    render(film());
    fireEvent.click(screen.getByRole('button', { name: 'Sedd' }));

    await act(async () => { fireEvent.click(screen.getByText('Sedd igen')); });

    expect(markSeen).toHaveBeenCalledTimes(1);
    expect(intentOfLastMarkSeen()).toBe(true);
  });

  // The case that made this a separate action at all.
  it('counts NOTHING when the user re-picks the plain Sedd option', async () => {
    render(film());
    fireEvent.click(screen.getByRole('button', { name: 'Sedd' }));

    // The menu entry, not the trigger — both read "Sedd" for a film already seen.
    const labels = screen.getAllByText('Sedd');
    await act(async () => { fireEvent.click(labels[labels.length - 1]); });

    expect(markSeen).toHaveBeenCalledTimes(1);
    expect(intentOfLastMarkSeen()).toBe(false);
  });

  it('is absent for a film that is not marked seen yet', () => {
    watchlist.getItem.mockReturnValue({ ...seenFilm, status: 'vill_se' } as WatchlistItem);
    render(film());
    fireEvent.click(screen.getByRole('button', { name: 'Vill se' }));

    expect(screen.queryByText('Sedd igen')).not.toBeInTheDocument();
  });

  it('is absent for an untracked title', () => {
    watchlist.getItem.mockReturnValue(null);
    render(film());
    fireEvent.click(screen.getByRole('button', { name: '+ Lägg till' }));

    expect(screen.queryByText('Sedd igen')).not.toBeInTheDocument();
  });

  // TV has no terminal 'sedd' (watchStatus.ts) — a series lands as 'mina', so a
  // rewatch cannot follow and the action would be meaningless.
  it('is absent for a series', () => {
    // Seeded as 'sedd' on purpose, so BOTH terms of the render condition are
    // pinned — a 'mina' seed would fail on the status term alone and leave the
    // media-type term free to vanish. (Unreachable in production: migrateStatus
    // maps a legacy TV 'sedd' to 'mina'.)
    watchlist.getItem.mockReturnValue({
      tmdbId: 1399, mediaType: 'tv', status: 'sedd', title: 'Game of Thrones',
    } as WatchlistItem);
    render(series());
    fireEvent.click(screen.getByRole('button', { name: 'Sedd (alla avsnitt)' }));

    expect(screen.queryByText('Sedd igen')).not.toBeInTheDocument();
  });
});

// BIN-596 — the button must not write before it knows two things: who the user
// is, and what is already in their library.
//
// `loading` from useWatchlist() cannot answer the second one: it goes false BOTH
// when the first snapshot lands and when the listener dies. Treating the second
// as "loaded, library empty" turns every re-mark into a genuine new add — which
// is how a "Sedd" tapped in the first second after landing on a film page wrote a
// doc with no `watchedAt` at all (absent from Dagbok, from Statistik's monthly
// activity, from Streamingrådgivarens value calculation, sorted last under "Sedd
// datum") with nothing to repair it and no message to the user.
//
// Every case here asserts the TOAST as well as the write. A gate that blocks the
// write but still says "The Matrix — Vill se" is worse than no gate: the user
// walks away believing it was saved.
describe('StatusButton — the write waits for auth AND the watchlist snapshot (BIN-596)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchlist.getItem.mockReturnValue(null);
    watchlist.snapshotSettled = true;
    watchlist.listenerFailed = false;
    auth.uid = 'u1';
    auth.user = { uid: 'u1' };
    auth.loading = false;
  });

  const trigger = () => screen.getByRole('button', { name: '+ Lägg till' });

  it('holds the action while the first snapshot is still in flight', async () => {
    watchlist.snapshotSettled = false;
    render(film());

    expect(trigger()).toBeDisabled();
    expect(trigger()).toHaveAttribute('title', 'Laddar…');

    await act(async () => { fireEvent.click(trigger()); });

    expect(screen.queryByText('Vill se')).not.toBeInTheDocument(); // menu stayed shut
    expect(watchlist.addItem).not.toHaveBeenCalled();
    expect(markSeen).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('reads a dead listener as FAILED, never as a loaded-and-empty library', async () => {
    // The distinction the whole ticket rests on. A failure that arrives AFTER a
    // snapshot landed leaves `snapshotSettled` true — so a gate written as
    // "settled?" alone would reopen here, with the library state it is holding
    // known to be stale.
    watchlist.snapshotSettled = true;
    watchlist.listenerFailed = true;
    render(film());

    // NOT disabled — this hold never ends on its own and `title=` does not
    // render on touch, so the disabled form is a control that stays silently
    // dead for the rest of a phone session (libraryHold.ts). It answers instead.
    expect(trigger()).not.toBeDisabled();
    expect(trigger()).toHaveAttribute('title', LIBRARY_UNAVAILABLE);

    await act(async () => { fireEvent.click(trigger()); });

    // What must NOT change: the tap still writes nothing and opens nothing.
    expect(watchlist.addItem).not.toHaveBeenCalled();
    expect(markSeen).not.toHaveBeenCalled();
    expect(screen.queryByText('Vill se')).not.toBeInTheDocument();
    // What DID change: it says why, in a way a touch device can show.
    expect(toast).toHaveBeenCalledWith(LIBRARY_UNAVAILABLE);
  });

  it('the explanation survives a menu that was already open when the listener died', async () => {
    // The order that makes the tappable trigger safe: opening is not the gate,
    // the write gate is. A menu opened while the library was known must not
    // write once the listener dies underneath it.
    const { rerender } = render(film());
    await act(async () => { fireEvent.click(trigger()); });
    expect(screen.getByText('Vill se')).toBeInTheDocument();

    // The listener dies with the menu still open, and the SAME instance
    // re-renders — a fresh render would only prove the closed-menu path.
    watchlist.listenerFailed = true;
    rerender(film());
    expect(screen.getByText('Vill se')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Vill se')); });

    expect(watchlist.addItem).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalledWith('The Matrix — Vill se');
  });

  it('holds while auth is still restoring a session, before the library is even asked', async () => {
    auth.uid = null;
    auth.loading = true;
    render(film());

    expect(trigger()).toBeDisabled();
    expect(trigger()).toHaveAttribute('title', 'Laddar…');
    expect(watchlist.addItem).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('a signed-out pick no longer no-ops behind a success toast', async () => {
    // The state login/page.tsx parked as this ticket: `addItem` returns early
    // without a uid, and the button confirmed the write anyway.
    auth.uid = null;
    auth.user = null;
    auth.loading = false;
    render(film());

    expect(trigger()).toBeDisabled();
    expect(trigger()).toHaveAttribute('title', 'Logga in för att lägga till');

    await act(async () => { fireEvent.click(trigger()); });

    expect(watchlist.addItem).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('keys signed-in on `uid`, not on the loaded profile', async () => {
    // AuthContext KEEPS uid when the profile read fails. Keying the gate on
    // `user` would leave that visitor with a permanently dead button.
    auth.uid = 'u1';
    auth.user = null;
    render(film());

    expect(trigger()).toBeEnabled();
  });

  it('releases the action once the snapshot lands — held, then flipped, then it writes', async () => {
    // Drives the whole transition rather than only the held half: a mutant that
    // latches on the way IN (never releasing) passes a "renders disabled" test
    // while stranding every user whose snapshot lands normally.
    watchlist.snapshotSettled = false;
    const view = render(film());
    expect(trigger()).toBeDisabled();

    watchlist.snapshotSettled = true;
    view.rerender(film());

    expect(trigger()).toBeEnabled();
    await act(async () => { fireEvent.click(trigger()); });
    await act(async () => { fireEvent.click(screen.getByText('Vill se')); });

    expect(watchlist.addItem).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('The Matrix — Vill se');
  });

  it('holds the seen-mark path too — markSeen fires its own toast', async () => {
    // 'Sedd' does not go through addItem, it goes through useMarkSeen, which
    // toasts (or nudges a rating) on its own. Gating only the addItem branch
    // would leave the confirmation intact on the path that matters most for a
    // missing watch date.
    watchlist.getItem.mockReturnValue(seenFilm);
    watchlist.snapshotSettled = false;
    render(film());

    const seenTrigger = screen.getByRole('button', { name: 'Sedd' });
    expect(seenTrigger).toBeDisabled();

    await act(async () => { fireEvent.click(seenTrigger); });

    expect(markSeen).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
