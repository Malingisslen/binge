// src/components/pages/FriendsPageClient.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, within } from '@testing-library/react';
import FriendsPageClient from './FriendsPageClient';

// BIN-1196. The friends page calls the same writes FriendButton does — removeFriend,
// acceptFriendRequest, declineFriendRequest — and until this ticket none of the three
// had a catch here, so a refused write was an unhandled rejection with nothing on
// screen.
//
// Two properties are pinned, and the second is the one a page of rows can get wrong in
// a way a single button never could:
//   1. every action says so, with the text for THAT action and nothing about the cause;
//   2. the message lands on the row whose button was pressed. The two "leaves the other
//      ... rows alone" cases below render a second row and read it, rather than taking
//      that on trust.

const actions = vi.hoisted(() => ({
  acceptFriendRequest: vi.fn(async (_uid: string) => {}),
  declineFriendRequest: vi.fn(async (_uid: string) => {}),
  removeFriend: vi.fn(async (_uid: string) => {}),
  cancelFriendRequest: vi.fn(async (_uid: string) => {}),
}));

const data = vi.hoisted(() => ({
  friends: [] as { uid: string; displayName: string; photoURL: string | null; username?: string }[],
  requests: [] as { fromUid: string; fromDisplayName: string; fromPhotoURL: string | null }[],
  following: [] as { uid: string; displayName: string; photoURL: string | null; username?: string }[],
  followers: [] as { uid: string; displayName: string; photoURL: string | null; username?: string }[],
  blocked: new Set<string>(),
  sent: [] as { toUid: string; displayName: string | null; username: string | null; sentAt: Date }[],
  username: 'malin' as string | null,
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ uid: 'me', user: { username: data.username } }),
}));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));
// The feed fans out reads of its own; this page only decides WHEN it is mounted.
vi.mock('@/components/social/FriendsFeed', () => ({
  FriendsFeed: () => <div data-testid="feed" />,
}));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));
const senders = vi.hoisted(() => new Map<string, { displayName: string | null; username: string | null }>());
vi.mock('@/hooks/useSenderProfile', () => ({
  useSenderProfile: (uid: string) => ({ data: senders.get(uid) ?? null }),
}));
vi.mock('@/hooks/useFollowList', () => ({
  useFollowList: () => ({ following: data.following, followers: data.followers, isLoading: false }),
}));
vi.mock('@/hooks/useBlockedUsers', () => ({
  useBlockedUsers: () => ({
    blockedUids: data.blocked,
    isBlocked: (uid: string) => data.blocked.has(uid),
    blockUser: vi.fn(),
    unblockUser: vi.fn(),
  }),
}));
vi.mock('@/hooks/useFollow', () => ({
  useFollowing: () => ({ isFollowing: () => false, followUser: vi.fn(), unfollowUser: vi.fn() }),
}));
// Tipsa en vän: the tip list and its rows. The row has its own test file.
const tipData = vi.hoisted(() => ({ tips: [] as { id: string; fromUid: string; mediaType: string; tmdbId: number; title: string; note: string | null; createdAt: Date }[] }));
vi.mock('@/hooks/useTips', () => ({ useTips: () => ({ data: tipData.tips }) }));
vi.mock('@/components/social/TipRow', () => ({
  TipRow: ({ tip }: { tip: { fromUid: string; title: string } }) => <li data-testid="tip">{tip.fromUid}:{tip.title}</li>,
}));
vi.mock('@/hooks/useFriends', () => ({
  useFriends: () => ({ data: data.friends, isLoading: false }),
  useFriendRequests: () => ({ data: data.requests, isLoading: false }),
  useSentFriendRequests: () => ({ data: data.sent, isLoading: false }),
  useFriendActions: () => actions,
}));

const friend = (uid: string, name: string) => ({ uid, displayName: name, photoURL: null });
const request = (uid: string, name: string) => ({
  fromUid: uid,
  fromDisplayName: name,
  fromPhotoURL: null,
});

/** Render, then switch to the tab whose button label starts with `label`. */
async function open(label: string) {
  const view = render(<FriendsPageClient />);
  if (label === 'Flöde') return view;
  const tab = view.getAllByRole('button').find((b) => b.textContent?.startsWith(label));
  if (!tab) throw new Error(`no tab starting with ${label}`);
  await act(async () => { fireEvent.click(tab); });
  return view;
}

// Removing a friend asks first; the write happens only on the dialog's own button.
async function confirmRemoval(trigger: HTMLElement, view: ReturnType<typeof render>) {
  await act(async () => { fireEvent.click(trigger); });
  const dialog = view.getByRole('dialog');
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Ta bort' })); });
}

/** The <li> that renders `name`, so an assertion can be scoped to one person's row. */
function rowFor(view: ReturnType<typeof render>, name: string) {
  const row = view.getByText(name).closest('li');
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  data.friends = [];
  data.requests = [];
  data.following = [];
  data.followers = [];
  data.blocked = new Set();
  data.sent = [];
  data.username = 'malin';
  senders.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('FriendsPageClient — a refused friend write says so, on its own row', () => {
  // A roster floor OUTSIDE the per-action cases below. The three actions are written
  // out as literals rather than read from the mock object, which would shrink with it.
  it('covers every friend write this page can start', () => {
    expect(Object.keys(actions).sort()).toEqual([
      'acceptFriendRequest',
      'cancelFriendRequest',
      'declineFriendRequest',
      'removeFriend',
    ]);
  });

  it('a refused removal says so next to that friend', async () => {
    data.friends = [friend('a', 'Anna')];
    actions.removeFriend.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'permission-denied' }),
    );
    const view = await open('Vänner');

    await confirmRemoval(view.getByText('Ta bort'), view);

    expect(actions.removeFriend).toHaveBeenCalledWith('a');
    expect(view.getByRole('alert').textContent).toBe('Kunde inte ta bort vännen.');
  });

  it('cancelling the confirmation removes nobody', async () => {
    data.friends = [friend('a', 'Anna')];
    const view = await open('Vänner');

    await act(async () => { fireEvent.click(view.getByText('Ta bort')); });
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Avbryt' })); });

    expect(actions.removeFriend).not.toHaveBeenCalled();
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('a removal that succeeds says nothing', async () => {
    data.friends = [friend('a', 'Anna')];
    const view = await open('Vänner');

    await confirmRemoval(view.getByText('Ta bort'), view);

    expect(view.queryByRole('alert')).toBeNull();
  });

  // The text may not depend on WHY the write failed: a refusal the recipient caused
  // must read the same as a dropped connection.
  it('a removal shows the same text whatever the error was', async () => {
    data.friends = [friend('a', 'Anna')];
    actions.removeFriend.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'unavailable' }),
    );
    const view = await open('Vänner');

    await confirmRemoval(view.getByText('Ta bort'), view);

    expect(view.getByRole('alert').textContent).toBe('Kunde inte ta bort vännen.');
  });

  // The case a single-button component cannot have. A flag held above the rows would
  // pass every test above and still print Anna's failure under Bertil's name.
  it('leaves the other friends rows alone when one removal fails', async () => {
    data.friends = [friend('a', 'Anna'), friend('b', 'Bertil')];
    actions.removeFriend.mockRejectedValueOnce(new Error('x'));
    const view = await open('Vänner');

    const annaRow = rowFor(view, 'Anna');
    await confirmRemoval(within(annaRow).getByText('Ta bort'), view);

    expect(within(annaRow).getByRole('alert').textContent).toBe('Kunde inte ta bort vännen.');
    expect(within(rowFor(view, 'Bertil')).queryByRole('alert')).toBeNull();
  });

  it('a refused accept says so, naming the accept', async () => {
    data.requests = [request('a', 'Anna')];
    actions.acceptFriendRequest.mockRejectedValueOnce(new Error('x'));
    const view = render(<FriendsPageClient />);

    await act(async () => { fireEvent.click(view.getByText('Acceptera')); });

    expect(actions.acceptFriendRequest).toHaveBeenCalledWith('a');
    expect(view.getByRole('alert').textContent).toBe('Kunde inte acceptera förfrågan.');
  });

  // Decline has no mode in FriendButton, so this text exists only here and in the
  // topbar popover. Its own string, not the accept one.
  it('a refused decline says so, naming the decline', async () => {
    data.requests = [request('a', 'Anna')];
    actions.declineFriendRequest.mockRejectedValueOnce(new Error('x'));
    const view = render(<FriendsPageClient />);

    await act(async () => { fireEvent.click(view.getByText('Avböj')); });

    expect(actions.declineFriendRequest).toHaveBeenCalledWith('a');
    expect(view.getByRole('alert').textContent).toBe('Kunde inte avböja förfrågan.');
  });

  it('leaves the other request rows alone when one accept fails', async () => {
    data.requests = [request('a', 'Anna'), request('b', 'Bertil')];
    actions.acceptFriendRequest.mockRejectedValueOnce(new Error('x'));
    const view = render(<FriendsPageClient />);

    const annaRow = rowFor(view, 'Anna');
    await act(async () => { fireEvent.click(within(annaRow).getByText('Acceptera')); });

    expect(within(annaRow).getByRole('alert').textContent).toBe('Kunde inte acceptera förfrågan.');
    expect(within(rowFor(view, 'Bertil')).queryByRole('alert')).toBeNull();
  });

  // Accept and decline sit side by side and can both be clicked. The banner belongs to
  // the LATEST click, so the abandoned one must not win it back when it settles.
  it('a second click abandons the first ones failure rather than racing it', async () => {
    data.requests = [request('a', 'Anna')];
    let rejectAccept!: (e: unknown) => void;
    actions.acceptFriendRequest.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { rejectAccept = reject; }),
    );
    const view = render(<FriendsPageClient />);

    await act(async () => { fireEvent.click(view.getByText('Acceptera')); });
    await act(async () => { fireEvent.click(view.getByText('Avböj')); });

    await act(async () => {
      rejectAccept(new Error('x'));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });

    expect(view.queryByRole('alert')).toBeNull();
  });
});

// BIN-1341. Someone I blocked stays out of every tab, and out of that tab's count.
// Each case puts the blocked person AND an unblocked one in the same list, so the
// assertion that the unblocked one is shown proves the list rendered at all.
describe('FriendsPageClient — a blocked person is left out of every tab', () => {
  const tabs = [
    { label: 'Vänner', seed: () => { data.friends = [friend('x', 'Xerxes'), friend('a', 'Anna')]; } },
    { label: 'Följer', seed: () => { data.following = [friend('x', 'Xerxes'), friend('a', 'Anna')]; } },
    { label: 'Följare', seed: () => { data.followers = [friend('x', 'Xerxes'), friend('a', 'Anna')]; } },
  ];

  // Roster floor outside the parameterised cases: the tab labels are read from the
  // page itself, so a tab added without a case here fails this test.
  it('has a case for every tab the page renders', () => {
    const view = render(<FriendsPageClient />);
    const rendered = view.getAllByRole('button')
      .filter((b) => b.textContent === 'Flöde' || /\(\d+\)$/.test(b.textContent ?? ''))
      .map((b) => b.textContent?.replace(/ \(\d+\)$/, ''))
      .sort();
    expect(rendered).toEqual(['Flöde', ...tabs.map((t) => t.label)].sort());
  });

  it.each(tabs)('$label hides the blocked person and does not count them', async ({ label, seed }) => {
    seed();
    data.blocked = new Set(['x']);
    const view = await open(label);

    expect(view.getByText('Anna')).toBeTruthy();
    expect(view.queryByText('Xerxes')).toBeNull();
    const tab = view.getAllByRole('button').find((b) => b.textContent?.startsWith(label));
    expect(tab?.textContent).toBe(`${label} (1)`);
  });

  it.each(tabs)('$label shows the same person when nobody is blocked', async ({ label, seed }) => {
    seed();
    const view = await open(label);

    expect(view.getByText('Xerxes')).toBeTruthy();
    const tab = view.getAllByRole('button').find((b) => b.textContent?.startsWith(label));
    expect(tab?.textContent).toBe(`${label} (2)`);
  });
});

describe('FriendsPageClient — a blocked person in the Väntar på dig box', () => {
  it('is left out of incoming and sent requests', () => {
    data.requests = [request('x', 'Xerxes'), request('a', 'Anna')];
    data.sent = [
      { toUid: 'y', displayName: 'Yngve', username: null, sentAt: new Date() },
      { toUid: 'b', displayName: 'Bertil', username: null, sentAt: new Date() },
    ];
    data.blocked = new Set(['x', 'y']);
    const view = render(<FriendsPageClient />);
    expect(view.getByText('Anna')).toBeTruthy();
    expect(view.getByText('Bertil')).toBeTruthy();
    expect(view.queryByText('Xerxes')).toBeNull();
    expect(view.queryByText('Yngve')).toBeNull();
  });
});

describe('FriendsPageClient — tabs and the Flöde default', () => {
  it('opens on Flöde and mounts the feed only there', async () => {
    data.friends = [friend('a', 'Anna')];
    const view = render(<FriendsPageClient />);
    expect(view.getByTestId('feed')).toBeTruthy();
    expect(view.queryByText('Anna')).toBeNull();
    const flode = view.getByRole('button', { name: 'Flöde' });
    expect(flode.className).toContain('text-acc-deep');

    await act(async () => { fireEvent.click(view.getByRole('button', { name: /^Vänner \(/ })); });
    expect(view.queryByTestId('feed')).toBeNull();
    expect(view.getByText('Anna')).toBeTruthy();
  });

  it('has no Förfrågningar tab any more', () => {
    const view = render(<FriendsPageClient />);
    expect(view.queryByRole('button', { name: /Förfrågningar/ })).toBeNull();
  });
});

describe('FriendsPageClient — the Väntar på dig box', () => {
  it('is absent when there are no incoming or sent requests', () => {
    const view = render(<FriendsPageClient />);
    expect(view.queryByText('Väntar på dig')).toBeNull();
  });

  it('shows a sent request by name, and Ångra cancels that uid', async () => {
    data.sent = [{ toUid: 'u1', displayName: 'Greta', username: 'greta', sentAt: new Date() }];
    const view = render(<FriendsPageClient />);
    expect(view.getByText('Väntar på dig')).toBeTruthy();
    expect(view.getByText('Greta')).toBeTruthy();
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Ångra' })); });
    expect(actions.cancelFriendRequest).toHaveBeenCalledWith('u1');
  });

  it('shows the handle when the name is unreadable, and a placeholder when nothing resolves', () => {
    data.sent = [
      { toUid: 'u1', displayName: null, username: 'greta', sentAt: new Date() },
      { toUid: 'u2', displayName: null, username: null, sentAt: new Date() },
    ];
    const view = render(<FriendsPageClient />);
    expect(view.getByText('@greta')).toBeTruthy();
    expect(view.getByText('Okänd användare')).toBeTruthy();
  });

  it('a refused cancel says so on that row', async () => {
    data.sent = [{ toUid: 'u1', displayName: 'Greta', username: null, sentAt: new Date() }];
    actions.cancelFriendRequest.mockRejectedValueOnce(new Error('x'));
    const view = render(<FriendsPageClient />);
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Ångra' })); });
    expect(view.getByRole('alert').textContent).toBe('Kunde inte avbryta förfrågan.');
  });
});

describe('FriendsPageClient — header actions', () => {
  it('copies the profile link and says so', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const view = render(<FriendsPageClient />);
    expect(view.getByText('Du heter @malin. Dela länken så kan vänner hitta dig.')).toBeTruthy();
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Kopiera min länk' })); });
    expect(writeText).toHaveBeenCalledWith('https://binge.nu/user/malin/');
    expect(toast).toHaveBeenCalledWith('Länken är kopierad');
  });

  it('says the copy failed when the clipboard refuses', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => { throw new Error('denied'); }) },
      configurable: true,
    });
    const view = render(<FriendsPageClient />);
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Kopiera min länk' })); });
    expect(toast).toHaveBeenCalledWith('Kunde inte kopiera länken');
  });

  it('points to Inställningar and offers no copy button without a username', () => {
    data.username = null;
    const view = render(<FriendsPageClient />);
    expect(view.queryByRole('button', { name: 'Kopiera min länk' })).toBeNull();
    expect(view.getByRole('link', { name: 'Inställningar' }).getAttribute('href')?.replace(/\/$/, '')).toBe('/settings');
  });

  it('has one Välj film med en vän link to /tillsammans/ny/', () => {
    data.friends = [friend('a', 'Anna'), friend('b', 'Bertil')];
    const view = render(<FriendsPageClient />);
    const links = view.getAllByRole('link', { name: 'Välj film med en vän' });
    expect(links).toHaveLength(1);
    // Next's Link drops the trailing slash in jsdom; the route itself is the claim.
    expect(links[0].getAttribute('href')?.replace(/\/$/, '')).toBe('/tillsammans/ny');
  });
});

// A friend without a display name is shown by their username (friendName.ts), and the
// @-line under it would then repeat the same word. The line stays whenever it adds
// something, since it is what tells two similar names apart.
describe('FriendsPageClient — the @username line', () => {
  it('is left out when the name shown is the username', async () => {
    data.friends = [{ uid: 'j', displayName: 'jonatan', photoURL: null, username: 'jonatan' }];
    const view = await open('Vänner');
    expect(within(rowFor(view, 'jonatan')).queryByText('@jonatan')).toBeNull();
  });

  it('stays when the name differs from the username', async () => {
    data.friends = [{ uid: 'j', displayName: 'Jonatan', photoURL: null, username: 'jonatan' }];
    const view = await open('Vänner');
    expect(within(rowFor(view, 'Jonatan')).getByText('@jonatan')).toBeTruthy();
  });
});

describe('FriendsPageClient — a request from a sender whose profile has no name', () => {
  it('shows the username from the profile, once', async () => {
    data.requests = [request('s', 'Användare')];
    senders.set('s', { displayName: '  ', username: 'sara' });
    const view = render(<FriendsPageClient />);
    const row = rowFor(view, 'sara');
    expect(within(row).queryByText('Användare')).toBeNull();
    expect(within(row).queryByText('@sara')).toBeNull();
  });

  it('keeps the @-line when the name and username differ', async () => {
    data.requests = [request('s', 'Sara')];
    senders.set('s', { displayName: 'Sara', username: 'sara' });
    const view = render(<FriendsPageClient />);
    expect(within(rowFor(view, 'Sara')).getByText('@sara')).toBeTruthy();
  });
});

describe('FriendsPageClient — tips in the Väntar på dig box (Tipsa en vän)', () => {
  const tip = (fromUid: string, title: string) => ({
    id: `${fromUid}_movie_603`, fromUid, mediaType: 'movie', tmdbId: 603, title, note: null, createdAt: new Date(),
  });

  beforeEach(() => { tipData.tips = []; });

  it('shows the box for tips alone, with no friend request waiting', () => {
    tipData.tips = [tip('anna', 'The Matrix')];
    const view = render(<FriendsPageClient />);
    const box = view.getByRole('region', { name: 'Väntar på dig' });
    expect(within(box).getByTestId('tip').textContent).toBe('anna:The Matrix');
  });

  it('leaves out a tip from someone I blocked, and the box with it when nothing else waits', () => {
    data.blocked = new Set(['bo']);
    tipData.tips = [tip('bo', 'Alien')];
    const view = render(<FriendsPageClient />);
    expect(view.queryByTestId('tip')).toBeNull();
    expect(view.queryByRole('region', { name: 'Väntar på dig' })).toBeNull();
  });

  it('keeps a tip from someone else when one sender is blocked', () => {
    data.blocked = new Set(['bo']);
    tipData.tips = [tip('bo', 'Alien'), tip('anna', 'The Matrix')];
    const view = render(<FriendsPageClient />);
    expect(view.getAllByTestId('tip').map(t => t.textContent)).toEqual(['anna:The Matrix']);
  });
});
