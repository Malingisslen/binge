// src/components/franchise/CompanionSection.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// BIN-730/731 — the companion strip's "Lägg i vill se" is a full add surface
// (it hard-writes status 'vill_se'), and until now nothing pinned who is allowed
// to fire it. It got BIN-596's library gate in the same sweep as the title-page
// buttons but without a test of its own, and BIN-731 then had to change what
// that gate does to a signed-out visitor. Both rules live here:
//
//  · signed in, library KNOWN            → the button writes
//  · signed in, listener DEAD            → held; `loading` has gone false but
//                                          getItem lies about every title, so a
//                                          write would demote a 'sedd' film
//  · signed OUT                          → not held at all: their tap is a
//                                          destination (/login, then back), the
//                                          same answer StatusButton and
//                                          QuickAddButton give (BIN-714/645)
//
// The signed-out case is the one that needs a test most: a library gate is false
// FOREVER for someone who will never have a listener, so a gate ordered ahead of
// the auth question leaves a permanently dead button with nothing saying why.

vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));

const upsertTitle = vi.hoisted(() => vi.fn());
const getItem = vi.hoisted(() => vi.fn(() => undefined as unknown));
const watchlist = vi.hoisted(() => ({
  snapshotSettled: false,
  listenerFailed: false,
  // Derived exactly as WatchlistContext derives it, so a test can express the
  // dead listener — the state where `loading` is false and the library is still
  // unknown, which a mock keyed on `loading` alone cannot represent.
  get libraryKnown(): boolean {
    return this.snapshotSettled && !this.listenerFailed;
  },
  getItem,
  upsertTitle,
}));
// ONE router object, never a per-call factory — a fresh mock per call would make
// every navigation assertion below vacuous (lessons-digest).
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }));
const auth = vi.hoisted(() => ({ user: null as unknown, uid: null as string | null, loading: false }));

const FILM = { mediaType: 'movie' as const, id: 559969, label: 'El Camino (2019)' };
const filmDetail = {
  id: FILM.id,
  title: 'El Camino: A Breaking Bad Movie',
  original_title: 'El Camino: A Breaking Bad Movie',
  release_date: '2019-10-11',
  poster_path: '/elcamino.jpg',
  genres: [{ id: 80, name: 'Crime' }],
};

vi.mock('@/lib/franchise/companions', () => ({ companionsFor: () => [FILM] }));
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
// The lite detail fetch: answered synchronously so the add path has a movie to
// build its payload from. The strip's own query wiring is not what is under test.
vi.mock('@tanstack/react-query', () => ({
  useQueries: () => [{ data: filmDetail, isLoading: false }],
}));
vi.mock('@/components/title/SeenPosterCard', () => ({ default: () => null }));
vi.mock('@/components/ui/JustWatchCredit', () => ({ default: () => null }));

import CompanionSection from './CompanionSection';

const addButton = () => screen.getByRole('button', { name: /Lägg i vill se/ }) as HTMLButtonElement;

beforeEach(() => {
  upsertTitle.mockReset();
  getItem.mockReset();
  getItem.mockReturnValue(undefined);
  router.push.mockReset();
  watchlist.snapshotSettled = false;
  watchlist.listenerFailed = false;
  auth.uid = 'uid-1';
  auth.loading = false;
});

describe('CompanionSection — who may fire "Lägg i vill se" (BIN-730/596/731)', () => {
  it('adds the film once the library is genuinely known', async () => {
    watchlist.snapshotSettled = true;
    render(<CompanionSection anchorMediaType="tv" anchorId={1396} />);

    const button = addButton();
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    // The add is async inside the handler; let the microtask queue drain.
    await Promise.resolve();
    expect(upsertTitle).toHaveBeenCalledWith(expect.objectContaining({
      tmdbId: FILM.id, mediaType: 'movie', status: 'vill_se',
    }));
  });

  it('holds the button while the first snapshot is still in flight', () => {
    render(<CompanionSection anchorMediaType="tv" anchorId={1396} />);

    expect(addButton().disabled).toBe(true);
  });

  it('holds it for a signed-in visitor whose listener died, and writes nothing', async () => {
    // The BIN-596 state: a snapshot DID land, then the listen terminally errored.
    // `libraryKnown` folds that in; `snapshotSettled` alone would say "safe".
    watchlist.snapshotSettled = true;
    watchlist.listenerFailed = true;
    render(<CompanionSection anchorMediaType="tv" anchorId={1396} />);

    const button = addButton();
    expect(button.disabled).toBe(true);
    fireEvent.click(button);

    await Promise.resolve();
    expect(upsertTitle).not.toHaveBeenCalled();
    // /login is not the answer to a broken library — they ARE signed in.
    expect(router.push).not.toHaveBeenCalled();
  });

  it('lets a signed-out visitor tap it and sends them to /login (BIN-731)', async () => {
    auth.uid = null;
    // They have no listener and never will this session, so the library gate is
    // false forever for them. Ordering it ahead of the auth question is exactly
    // how the tap goes dead.
    watchlist.snapshotSettled = false;
    render(<CompanionSection anchorMediaType="tv" anchorId={1396} />);

    const button = addButton();
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await Promise.resolve();
    expect(router.push).toHaveBeenCalledWith('/login/');
    // A signed-out add would be refused by the rules anyway; the point is that
    // nothing pretends otherwise.
    expect(upsertTitle).not.toHaveBeenCalled();
  });

  it('does not treat an unresolved auth state as signed out', () => {
    auth.uid = null;
    auth.loading = true;
    render(<CompanionSection anchorMediaType="tv" anchorId={1396} />);

    // Unknown is not "signed out": routing to /login here would bounce a
    // signed-in visitor out of the page they are still restoring.
    expect(addButton().disabled).toBe(true);
  });
});
