// src/components/title/QuickAddButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import QuickAddButton from './QuickAddButton';
import { LIBRARY_UNAVAILABLE } from './libraryHold';
import type { MediaType, WatchlistItem } from '@/types';
import { DELETION_IN_PROGRESS, DELETION_IN_PROGRESS_MESSAGE } from '@/lib/deletionInProgressError';

// BIN-645: the plus badge on poster grids used to call signIn() inline. A
// first-time Google sign-in CREATES the account, and account creation stamps
// termsAcceptedAt + ageConfirmedAt (13+) — but a grid of posters shows neither
// the villkor link nor the 13-års-notisen. So it recorded a consent the visitor
// was never shown. It now routes to /login, where those notices live, and
// remembers the page they were reading so they land back on it afterwards —
// in sessionStorage, not a ?next= param: a query would ride along to Firebase's
// Google-hosted auth handler, and would be attacker-supplied.
//
// The other half is WHO counts as signed out: `uid` (the auth verdict), never
// `user` (the Firestore profile). AuthContext deliberately keeps uid when a
// profile read fails, so keying on the profile would send an already-signed-in
// user to the login page on every tap, forever.

const auth = vi.hoisted(() => ({
  uid: 'u1' as string | null,
  // The real useAuth() returns a profile too. Without it here, the case named
  // for "no loaded profile" would encode ABSENT rather than null, and the
  // profile-keyed mutation it exists to catch would spare it.
  user: null as { uid: string } | null,
  loading: false,
  signIn: vi.fn(async () => {}),
}));
const watchlist = vi.hoisted(() => ({
  getItem: vi.fn<(mediaType: MediaType, tmdbId: number) => WatchlistItem | null>(() => null),
  upsertTitle: vi.fn(),
  removeItem: vi.fn(),
  // BIN-596: the readiness pair. `loading` is deliberately NOT here — it cannot
  // tell a landed snapshot from a dead listener, which is the whole point.
  snapshotSettled: true,
  listenerFailed: false,
  // Derived exactly as the provider derives it, as a getter rather than a fixed
  // value: a literal here would let a test set `listenerFailed` and still hand
  // the component `libraryKnown: true`, which is a state production cannot
  // produce — every gate assertion in this file would go vacuous.
  get libraryKnown(): boolean { return this.snapshotSettled && !this.listenerFailed; },
}));
const markSeen = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/hooks/useMarkSeen', () => ({ useMarkSeen: () => markSeen }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));
vi.mock('@/lib/firebase/episodeProgress', () => ({ clearEpisodeProgress: vi.fn() }));

const trackedSeries = {
  tmdbId: 1399,
  mediaType: 'tv',
  status: 'mina',
  title: 'Game of Thrones',
  rating: 4.5,
} as WatchlistItem;

const button = () => (
  <QuickAddButton
    tmdbId={1399}
    mediaType="tv"
    title="Game of Thrones"
    posterPath={null}
    releaseYear={2011}
  />
);

describe('QuickAddButton — signed-out taps reach the consent notice (BIN-645)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    auth.uid = 'u1';
    auth.user = { uid: 'u1' };

    auth.loading = false;
    watchlist.getItem.mockReturnValue(trackedSeries);
    watchlist.snapshotSettled = true;
    watchlist.listenerFailed = false;
  });

  it('sends a signed-out visitor to /login, carrying where they came from', async () => {
    auth.uid = null;
    watchlist.getItem.mockReturnValue(null);
    render(button());

    // The badge reads window.location, not usePathname() — it renders on /search,
    // whose whole state is the ?q= query, and usePathname() drops it.
    window.history.replaceState({}, '', '/tv/1399/?q=got');
    await act(async () => { fireEvent.click(screen.getByTitle('Lägg till')); });

    expect(push).toHaveBeenCalledWith('/login/');
    // …and the return path rides in storage, not the URL — a ?next= would travel
    // to Firebase's Google-hosted auth handler and be attacker-supplied.
    expect(window.sessionStorage.getItem('binge:nextAfterLogin')).toBe('/tv/1399/?q=got');
    // The whole point: no account is created from a surface with no notice.
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(screen.queryByText('Följ')).not.toBeInTheDocument();
  });

  it('treats a signed-in user with no loaded profile as signed IN', async () => {
    // AuthContext keeps uid and nulls the profile when the profile read fails.
    auth.uid = 'u1';
    auth.user = null;
    render(button());

    await act(async () => { fireEvent.click(screen.getByTitle('Följer')); });

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText('Följ')).toBeInTheDocument();
  });

  it('is disabled, not just inert, while auth is still restoring a session', async () => {
    auth.uid = null;
    auth.loading = true;
    watchlist.getItem.mockReturnValue(null);
    render(button());

    // Visibly disabled — an enabled button that swallows the tap reads as broken.
    const trigger = screen.getByTitle('Laddar…');
    expect(trigger).toBeDisabled();

    await act(async () => { fireEvent.click(trigger); });

    // Behind the disabled attribute jsdom fires no handler, so what these pin
    // is the ATTRIBUTE above — not the early-returns in the handler.
    expect(push).not.toHaveBeenCalled();
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(screen.queryByText('Följ')).not.toBeInTheDocument();
  });

  it('still opens the menu and writes for a signed-in user', async () => {
    render(button());
    await act(async () => { fireEvent.click(screen.getByTitle('Följer')); });
    await act(async () => { fireEvent.click(screen.getByText('Följ')); });

    expect(watchlist.upsertTitle).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
});

// BIN-596 — the second half of the same gate: knowing WHO the visitor is is not
// enough, we also have to know what is already in their library before writing.
// `loading` from useWatchlist() cannot say: it goes false both when the first
// snapshot lands and when the listener dies, and a dead listener is not an empty
// library — treating it as one turns every re-mark into a genuine new add
// (BIN-601/BIN-593). The badge sits on poster grids, where a tap comes within a
// second of the page appearing, so this is the common path and not an edge case.
describe('QuickAddButton — the write also waits for the watchlist snapshot (BIN-596)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    auth.uid = 'u1';
    auth.user = { uid: 'u1' };
    auth.loading = false;
    watchlist.getItem.mockReturnValue(trackedSeries);
    watchlist.snapshotSettled = true;
    watchlist.listenerFailed = false;
  });

  it('holds the menu while the first snapshot is still in flight', async () => {
    watchlist.snapshotSettled = false;
    render(button());

    const trigger = screen.getByTitle('Laddar…');
    expect(trigger).toBeDisabled();

    await act(async () => { fireEvent.click(trigger); });

    expect(screen.queryByText('Följ')).not.toBeInTheDocument();
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(markSeen).not.toHaveBeenCalled();
  });

  it('reads a dead listener as FAILED, not as a loaded-and-empty library', async () => {
    // Failure after a landed snapshot: `snapshotSettled` stays true, so a gate
    // written as "settled?" alone would reopen exactly when the state it trusts
    // is known to be stale.
    watchlist.listenerFailed = true;
    render(button());

    const trigger = screen.getByTitle(LIBRARY_UNAVAILABLE);
    // NOT disabled: this badge sits on a poster grid a phone scrolls, `title=`
    // never renders on touch, and this hold has no end — so the disabled form
    // is a control that is silently dead all session (libraryHold.ts).
    expect(trigger).not.toBeDisabled();

    await act(async () => { fireEvent.click(trigger); });

    // Unchanged: no write, and the menu does not open (every option in it is
    // gated, so opening it would only offer taps that do nothing).
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
    expect(markSeen).not.toHaveBeenCalled();
    expect(screen.queryByText('Vill se')).not.toBeInTheDocument();
    // Changed: it says why, through the one channel a touch device can show.
    expect(toast).toHaveBeenCalledWith(LIBRARY_UNAVAILABLE);
  });

  it('a signed-out visitor is NOT held by the library gate — their tap has a destination', async () => {
    // Production shape for a signed-out visitor: no listener runs, so
    // `snapshotSettled` is false forever. Gating on it without excluding them
    // would kill BIN-645's whole route to the consent notice.
    auth.uid = null;
    auth.user = null;
    watchlist.snapshotSettled = false;
    watchlist.getItem.mockReturnValue(null);
    render(button());

    const trigger = screen.getByTitle('Lägg till');
    expect(trigger).toBeEnabled();

    await act(async () => { fireEvent.click(trigger); });

    expect(push).toHaveBeenCalledWith('/login/');
  });

  it('releases the menu once the snapshot lands — held, then flipped, then it writes', async () => {
    // The transition, not just the held state: a mutant that latches on the way
    // in passes a "renders disabled" assertion while stranding every user whose
    // snapshot lands normally.
    watchlist.snapshotSettled = false;
    const view = render(button());
    expect(screen.getByTitle('Laddar…')).toBeDisabled();

    watchlist.snapshotSettled = true;
    view.rerender(button());

    await act(async () => { fireEvent.click(screen.getByTitle('Följer')); });
    await act(async () => { fireEvent.click(screen.getByText('Följ')); });

    expect(watchlist.upsertTitle).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
  });
});

// BIN-814. Same middle-link gap as StatusButton: the card surfaces derive the
// provider pair and pass it down, the hooks write it, and nothing asserted this
// component forwards it. Deleting both forwards left this file 8/8 green.
describe('QuickAddButton — forwards both provider fields to the write (BIN-814)', () => {
  const VIAPLAY = 76;
  const withProviders = () => (
    <QuickAddButton
      tmdbId={1399} mediaType="tv" title="Game of Thrones" posterPath={null} releaseYear={2011}
      providers={[VIAPLAY, 8]} subscriptionProviders={[8]}
    />
  );

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    auth.uid = 'u1';
    auth.user = { uid: 'u1' };
    auth.loading = false;
    watchlist.snapshotSettled = true;
    watchlist.listenerFailed = false;
    watchlist.getItem.mockReturnValue(null);
  });

  it('carries the subscription subset into upsertTitle', async () => {
    render(withProviders());
    await act(async () => { fireEvent.click(screen.getByTitle(/Följer|Lägg till/)); });
    await act(async () => { fireEvent.click(screen.getByText('Följ')); });

    expect(watchlist.upsertTitle).toHaveBeenCalledTimes(1);
    const payload = watchlist.upsertTitle.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.providers).toEqual([VIAPLAY, 8]);
    expect(payload.subscriptionProviders).toEqual([8]);
  });

  // The sedd path goes through markSeen instead of upsertTitle, and its twin
  // StatusButton pins both. Pinning only one of the two here would leave the pair
  // asymmetrically covered for no reason.
  it('carries the subscription subset into markSeen on the sedd path', async () => {
    render(withProviders());
    await act(async () => { fireEvent.click(screen.getByTitle(/Följer|Lägg till/)); });
    // TV's terminal option is labelled "Sedd (alla avsnitt)" — statusLabel, not 'Sedd'.
    await act(async () => { fireEvent.click(screen.getByText('Sedd (alla avsnitt)')); });

    expect(markSeen).toHaveBeenCalledTimes(1);
    const input = markSeen.mock.calls[0][0] as Record<string, unknown>;
    expect(input.providers).toEqual([VIAPLAY, 8]);
    expect(input.subscriptionProviders).toEqual([8]);
  });
});

describe('QuickAddButton — a refused write SAYS so (BIN-1038)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.uid = 'u1';
    auth.user = { uid: 'u1' };
    auth.loading = false;
    watchlist.snapshotSettled = true;
    watchlist.listenerFailed = false;
    watchlist.getItem.mockReturnValue(null);
  });

  it('tells the user the account is being deleted instead of closing the menu in silence', async () => {
    // BIN-1025 made `writeTitle` refuse by throwing while an account deletion runs. The
    // toast here already waited for the write, so nothing false was ever confirmed — but
    // nothing was said either, and the rejection left this handler unhandled.
    watchlist.upsertTitle.mockRejectedValueOnce(new Error(`${DELETION_IN_PROGRESS}: refused`));
    render(button());

    await act(async () => { fireEvent.click(screen.getByTitle(/Följer|Lägg till/)); });
    await act(async () => { fireEvent.click(screen.getByText('Följ')); });

    expect(watchlist.upsertTitle).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(DELETION_IN_PROGRESS_MESSAGE);
    // The success line must still be absent — this is BIN-895's rule and it is what the
    // narrow catch is guarding. A catch written broadly enough to fall through to the toast
    // below would pass every other assertion here.
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('Game of Thrones —'));
    // Retrying cannot work: the marker does not clear on its own.
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('försök igen'));
  });

  it('still lets a GENUINE failure propagate — the catch is narrow, not a swallow', async () => {
    // The control, and the one that keeps the test above from being satisfied by a
    // `catch { toast(...) }`: a catch that wide would report every real write failure to the
    // user as an account deletion, which is worse than the silence it replaced.
    //
    // The handler is an unawaited async click handler, so a rethrow leaves as an unhandled
    // rejection rather than something `act()` can hand back. It is captured here and
    // asserted directly — the rethrow IS the behaviour under test, so suppressing it without
    // asserting it would be the weaker version of this test.
    const escaped: unknown[] = [];
    const onUnhandled = (reason: unknown) => { escaped.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      watchlist.upsertTitle.mockRejectedValueOnce(new Error('firestore/unavailable'));
      render(button());

      await act(async () => { fireEvent.click(screen.getByTitle(/Följer|Lägg till/)); });
      await act(async () => { fireEvent.click(screen.getByText('Följ')); });
      // A macrotask, not a microtask flush: node decides a rejection is unhandled only at
      // the END of the turn, so an `await Promise.resolve()` here observes nothing and the
      // assertion below would read as "it did not rethrow".
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

      expect((escaped[0] as Error)?.message).toBe('firestore/unavailable');
      expect(toast).not.toHaveBeenCalledWith(DELETION_IN_PROGRESS_MESSAGE);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
