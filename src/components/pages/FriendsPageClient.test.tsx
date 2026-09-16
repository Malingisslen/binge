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
}));

const data = vi.hoisted(() => ({
  friends: [] as { uid: string; displayName: string; photoURL: string | null; username?: string }[],
  requests: [] as { fromUid: string; fromDisplayName: string; fromPhotoURL: string | null }[],
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'me' }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));
vi.mock('@/hooks/useSenderProfile', () => ({ useSenderProfile: () => ({ data: null }) }));
vi.mock('@/hooks/useFollowList', () => ({
  useFollowList: () => ({ following: [], followers: [], isLoading: false }),
}));
vi.mock('@/hooks/useFollow', () => ({
  useFollowing: () => ({ isFollowing: () => false, followUser: vi.fn(), unfollowUser: vi.fn() }),
}));
vi.mock('@/hooks/useFriends', () => ({
  useFriends: () => ({ data: data.friends, isLoading: false }),
  useFriendRequests: () => ({ data: data.requests, isLoading: false }),
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
  const tab = view.getAllByRole('button').find((b) => b.textContent?.startsWith(label));
  if (!tab) throw new Error(`no tab starting with ${label}`);
  await act(async () => { fireEvent.click(tab); });
  return view;
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
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('FriendsPageClient — a refused friend write says so, on its own row', () => {
  // A roster floor OUTSIDE the per-action cases below. The three actions are written
  // out as literals rather than read from the mock object, which would shrink with it.
  it('covers every friend write this page can start', () => {
    expect(Object.keys(actions).sort()).toEqual([
      'acceptFriendRequest',
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

    await act(async () => { fireEvent.click(view.getByText('Ta bort')); });

    expect(actions.removeFriend).toHaveBeenCalledWith('a');
    expect(view.getByRole('alert').textContent).toBe('Kunde inte ta bort vännen.');
  });

  it('a removal that succeeds says nothing', async () => {
    data.friends = [friend('a', 'Anna')];
    const view = await open('Vänner');

    await act(async () => { fireEvent.click(view.getByText('Ta bort')); });

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

    await act(async () => { fireEvent.click(view.getByText('Ta bort')); });

    expect(view.getByRole('alert').textContent).toBe('Kunde inte ta bort vännen.');
  });

  // The case a single-button component cannot have. A flag held above the rows would
  // pass every test above and still print Anna's failure under Bertil's name.
  it('leaves the other friends rows alone when one removal fails', async () => {
    data.friends = [friend('a', 'Anna'), friend('b', 'Bertil')];
    actions.removeFriend.mockRejectedValueOnce(new Error('x'));
    const view = await open('Vänner');

    const annaRow = rowFor(view, 'Anna');
    await act(async () => { fireEvent.click(within(annaRow).getByText('Ta bort')); });

    expect(within(annaRow).getByRole('alert').textContent).toBe('Kunde inte ta bort vännen.');
    expect(within(rowFor(view, 'Bertil')).queryByRole('alert')).toBeNull();
  });

  it('a refused accept says so, naming the accept', async () => {
    data.requests = [request('a', 'Anna')];
    actions.acceptFriendRequest.mockRejectedValueOnce(new Error('x'));
    const view = await open('Förfrågningar');

    await act(async () => { fireEvent.click(view.getByText('Acceptera')); });

    expect(actions.acceptFriendRequest).toHaveBeenCalledWith('a');
    expect(view.getByRole('alert').textContent).toBe('Kunde inte acceptera förfrågan.');
  });

  // Decline has no mode in FriendButton, so this text exists only here and in the
  // topbar popover. Its own string, not the accept one.
  it('a refused decline says so, naming the decline', async () => {
    data.requests = [request('a', 'Anna')];
    actions.declineFriendRequest.mockRejectedValueOnce(new Error('x'));
    const view = await open('Förfrågningar');

    await act(async () => { fireEvent.click(view.getByText('Avböj')); });

    expect(actions.declineFriendRequest).toHaveBeenCalledWith('a');
    expect(view.getByRole('alert').textContent).toBe('Kunde inte avböja förfrågan.');
  });

  it('leaves the other request rows alone when one accept fails', async () => {
    data.requests = [request('a', 'Anna'), request('b', 'Bertil')];
    actions.acceptFriendRequest.mockRejectedValueOnce(new Error('x'));
    const view = await open('Förfrågningar');

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
    const view = await open('Förfrågningar');

    await act(async () => { fireEvent.click(view.getByText('Acceptera')); });
    await act(async () => { fireEvent.click(view.getByText('Avböj')); });

    await act(async () => {
      rejectAccept(new Error('x'));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });

    expect(view.queryByRole('alert')).toBeNull();
  });
});
