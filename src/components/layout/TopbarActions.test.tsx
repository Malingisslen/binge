// src/components/layout/TopbarActions.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import TopbarActions from './TopbarActions';

// BIN-668: the topbar's "Logga in" used to call signIn() directly. A first-time
// Google sign-in CREATES the account, and account creation stamps
// termsAcceptedAt + ageConfirmedAt — but the villkor link and the 13-års notice
// only exist on /login. So the two things worth pinning here are:
//
//  1. the tap ROUTES to /login and never reaches signIn(), and
//  2. the return path is remembered INCLUDING the query string (the topbar
//     renders on /search, whose whole state is ?q=).
//
// The auth-loading case is driven as a TRANSITION rather than a single frozen
// render: a mutant that only ever shows the button while auth is unresolved, or
// one that latches it off for good, both survive a "render loading, assert
// absent" test.

const auth = vi.hoisted(() => ({
  user: null as { displayName: string; username?: string } | null,
  uid: null as string | null,
  loading: false,
  signIn: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  markNotificationsSeen: vi.fn(async () => {}),
}));
const push = vi.hoisted(() => vi.fn());

// ONE router object for the whole file, the way Next's real useRouter behaves —
// a per-call factory would hand every render a fresh identity and quietly make
// any identity-sensitive assertion pass for the wrong reason.
vi.mock('next/navigation', () => {
  const router = { push };
  return { useRouter: () => router };
});
// BIN-1196: ONE object each, hoisted, rather than a fresh literal per call. A per-call
// factory hands every render new identities and makes any assertion that spans two
// renders — or any mock rejection set up before one — pass for the wrong reason.
const notif = vi.hoisted(() => ({
  notifications: [] as unknown[],
  friendRequests: [] as { fromUid: string; fromDisplayName: string; fromPhotoURL: string | null }[],
  recentPicks: [] as unknown[],
  unreadCount: 0,
  friendRequestsCount: 0,
  providerUnreadCount: 0,
  recentPicksCount: 0,
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));
const friendActions = vi.hoisted(() => ({
  acceptFriendRequest: vi.fn(async (_uid: string) => {}),
  declineFriendRequest: vi.fn(async (_uid: string) => {}),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => notif }));
vi.mock('@/hooks/useFriends', () => ({ useFriendActions: () => friendActions }));
vi.mock('@/hooks/useMySessions', () => ({ useMySessions: () => [] }));
vi.mock('@/hooks/useClickOutside', () => ({ useClickOutside: () => {} }));
vi.mock('@/hooks/useSenderProfile', () => ({ useSenderProfile: () => ({ data: null }) }));

const STORAGE_KEY = 'binge:nextAfterLogin';

describe('TopbarActions — signing in from the topbar (BIN-668)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    auth.user = null;
    auth.uid = null;
    auth.loading = false;
  });

  it('sends a signed-out visitor to /login instead of creating the account on the spot', async () => {
    window.history.replaceState({}, '', '/search?q=dune');
    await act(async () => { render(<TopbarActions />); });

    fireEvent.click(screen.getByRole('button', { name: 'Logga in' }));

    expect(push).toHaveBeenCalledWith('/login/');
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('remembers the whole address including the query, so /search comes back with its term', async () => {
    window.history.replaceState({}, '', '/search?q=dune');
    await act(async () => { render(<TopbarActions />); });

    fireEvent.click(screen.getByRole('button', { name: 'Logga in' }));

    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe('/search?q=dune');
  });

  it('offers the sign-in only after auth resolves — and does offer it once it has', async () => {
    auth.loading = true;
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<TopbarActions />); });
    expect(screen.queryByRole('button', { name: 'Logga in' })).toBeNull();

    // Drive the whole transition: the button must APPEAR when the verdict lands
    // and still route, not merely be absent while we waited.
    auth.loading = false;
    await act(async () => { view.rerender(<TopbarActions />); });

    fireEvent.click(screen.getByRole('button', { name: 'Logga in' }));
    expect(push).toHaveBeenCalledWith('/login/');
  });

  it('shows no sign-in button at all once a uid exists, even before the profile lands', async () => {
    // AuthContext keeps uid and nulls the profile when the Firestore read fails.
    // Keying this branch on `user` would offer a signed-in visitor a login trip.
    auth.uid = 'u1';
    auth.user = null;
    await act(async () => { render(<TopbarActions />); });

    expect(screen.queryByRole('button', { name: 'Logga in' })).toBeNull();
  });
});

// BIN-1196. The popover's Accept/Decline call the same writes FriendButton does, and
// had no catch: a refused write was an unhandled rejection with nothing on screen, in a
// panel the user opened precisely to act on the request.
describe('TopbarActions — a refused friend-request write says so, on its own row', () => {
  const request = (uid: string, name: string) => ({
    fromUid: uid,
    fromDisplayName: name,
    fromPhotoURL: null,
  });

  /** Sign in, seed the requests, open the bell. */
  async function openBell(requests: ReturnType<typeof request>[]) {
    auth.user = { displayName: 'Malin' };
    auth.uid = 'me';
    notif.friendRequests = requests;
    notif.friendRequestsCount = requests.length;
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<TopbarActions />); });
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: /Notiser/ }));
    });
    return view;
  }

  /** The `.friend-req` row that renders `name`, so an assertion can be scoped to it. */
  function rowFor(view: ReturnType<typeof render>, name: string) {
    const row = view.getByText(name).closest('.friend-req');
    if (!row) throw new Error(`no request row for ${name}`);
    return row as HTMLElement;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    notif.notifications = [];
    notif.friendRequests = [];
    notif.recentPicks = [];
    notif.unreadCount = 0;
    notif.friendRequestsCount = 0;
    notif.recentPicksCount = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('a refused accept says so, naming the accept', async () => {
    friendActions.acceptFriendRequest.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'permission-denied' }),
    );
    const view = await openBell([request('a', 'Anna')]);

    await act(async () => { fireEvent.click(view.getByText('Acceptera')); });

    expect(friendActions.acceptFriendRequest).toHaveBeenCalledWith('a');
    expect(view.getByRole('alert').textContent).toBe('Kunde inte acceptera förfrågan.');
  });

  it('a refused decline says so, naming the decline', async () => {
    friendActions.declineFriendRequest.mockRejectedValueOnce(new Error('x'));
    const view = await openBell([request('a', 'Anna')]);

    await act(async () => { fireEvent.click(view.getByText('Avböj')); });

    expect(friendActions.declineFriendRequest).toHaveBeenCalledWith('a');
    expect(view.getByRole('alert').textContent).toBe('Kunde inte avböja förfrågan.');
  });

  // Same action, a different cause: the text may not change, or the sender could read
  // the reason out of it.
  it('shows the same text whatever the error was', async () => {
    friendActions.acceptFriendRequest.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'unavailable' }),
    );
    const view = await openBell([request('a', 'Anna')]);

    await act(async () => { fireEvent.click(view.getByText('Acceptera')); });

    expect(view.getByRole('alert').textContent).toBe('Kunde inte acceptera förfrågan.');
  });

  it('says nothing when the write succeeds', async () => {
    const view = await openBell([request('a', 'Anna')]);

    await act(async () => { fireEvent.click(view.getByText('Acceptera')); });

    expect(view.queryByRole('alert')).toBeNull();
  });

  // The popover lists up to five requests. A flag held above the rows would pass every
  // test above and still print Annas failure under Bertils name.
  it('leaves the other rows alone when one accept fails', async () => {
    friendActions.acceptFriendRequest.mockRejectedValueOnce(new Error('x'));
    const view = await openBell([request('a', 'Anna'), request('b', 'Bertil')]);

    const annaRow = rowFor(view, 'Anna');
    await act(async () => { fireEvent.click(within(annaRow).getByText('Acceptera')); });

    expect(within(annaRow).getByRole('alert').textContent).toBe('Kunde inte acceptera förfrågan.');
    expect(within(rowFor(view, 'Bertil')).queryByRole('alert')).toBeNull();
  });
});

// BIN-1259. Ett system-kort UTAN `actionUrl` är den normala formen sedan
// anmälarens besked finns — rapporten är läsbar bara för admin, så kortet har
// medvetet ingen sida att öppna. Reservvägen `|| '/insikter'` skickade varje
// sådant kort till adminsidan, och den grenen var opinnad: en återgång till den
// ovillkorliga länken hade shippat tyst.
describe('TopbarActions — systemnotiser med och utan länk (BIN-1259)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notif.friendRequests = [];
    notif.friendRequestsCount = 0;
  });

  const systemCard = (over: Record<string, unknown> = {}) => ({
    id: 'n1',
    tmdbId: 0,
    mediaType: 'movie',
    kind: 'system',
    title: 'Din anmälan',
    body: 'Vi har granskat din anmälan.',
    providerId: null,
    providerName: null,
    episodeCode: null,
    read: false,
    createdAt: new Date('2026-09-20'),
    ...over,
  });

  async function openBellWith(cards: unknown[]) {
    auth.user = { displayName: 'Malin' };
    auth.uid = 'me';
    notif.notifications = cards;
    notif.unreadCount = cards.length;
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<TopbarActions />); });
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: /Notiser/ }));
    });
    return view;
  }

  it('ett kort utan actionUrl renderas som en rad, inte som en länk', async () => {
    const view = await openBellWith([systemCard()]);
    const row = view.getByText('Din anmälan').closest('a, button');
    expect(row).toBeTruthy();
    expect(row!.tagName).toBe('BUTTON');
    expect(row!.getAttribute('href')).toBeNull();
  });

  // Kontrollen åt andra hållet. Utan den hade en trasig gren som ALDRIG länkar
  // uppfyllt testet ovan lika bra.
  it('ett kort med actionUrl är fortfarande en länk dit', async () => {
    const view = await openBellWith([systemCard({ actionUrl: '/insikter' })]);
    const row = view.getByText('Din anmälan').closest('a, button');
    expect(row!.tagName).toBe('A');
    expect(row!.getAttribute('href')).toBe('/insikter');
  });

  it('ingen av formerna skickar läsaren till /insikter utan att kortet bett om det', async () => {
    const view = await openBellWith([systemCard()]);
    const row = view.getByText('Din anmälan').closest('a, button');
    expect(row!.outerHTML).not.toContain('/insikter');
  });

  it('en klickad rad markeras som läst oavsett form', async () => {
    const view = await openBellWith([systemCard()]);
    await act(async () => {
      fireEvent.click(view.getByText('Din anmälan'));
    });
    expect(notif.markRead).toHaveBeenCalledWith('n1');
  });
});
