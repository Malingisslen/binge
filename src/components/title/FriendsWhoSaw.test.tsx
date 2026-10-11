import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { FriendWhoSaw } from '@/hooks/useFriendsWhoSaw';

const h = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('@/hooks/useFriendsWhoSaw', () => ({ useFriendsWhoSaw: () => ({ data: h.data }) }));

import FriendsWhoSaw from './FriendsWhoSaw';

const person = (uid: string, relation: FriendWhoSaw['relation'], over: Partial<FriendWhoSaw> = {}): FriendWhoSaw => ({
  uid, relation, status: 'sedd', rating: null, displayName: `Person ${uid}`, username: uid, photoURL: null, ...over,
});

beforeEach(() => { h.data = undefined; });

describe('FriendsWhoSaw', () => {
  it('renders nothing when nobody has the title', () => {
    h.data = [];
    const { container } = render(<FriendsWhoSaw mediaType="movie" tmdbId={1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows both labelled groups, with the old wording gone', () => {
    h.data = [person('a', 'friend', { rating: 4 }), person('b', 'following', { status: 'vill_se' })];
    render(<FriendsWhoSaw mediaType="movie" tmdbId={1} />);
    const friends = screen.getByRole('group', { name: 'Vänner' });
    const following = screen.getByRole('group', { name: 'Du följer' });
    expect(within(friends).getByText('Person a')).toBeInTheDocument();
    expect(within(friends).getByText('4★')).toBeInTheDocument();
    expect(within(following).getByText('Person b')).toBeInTheDocument();
    expect(within(following).getByText('vill se')).toBeInTheDocument();
    expect(screen.queryByText(/vänner som sett detta/i)).toBeNull();
  });

  it('shows only the label of the group that has hits', () => {
    h.data = [person('b', 'following')];
    render(<FriendsWhoSaw mediaType="movie" tmdbId={1} />);
    expect(screen.getByRole('group', { name: 'Du följer' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Vänner' })).toBeNull();
  });

  it('caps each group at 8 and shows +N per group', () => {
    h.data = [
      ...Array.from({ length: 10 }, (_, i) => person(`f${i}`, 'friend')),
      ...Array.from({ length: 9 }, (_, i) => person(`g${i}`, 'following')),
    ];
    render(<FriendsWhoSaw mediaType="movie" tmdbId={1} />);
    const friends = screen.getByRole('group', { name: 'Vänner' });
    const following = screen.getByRole('group', { name: 'Du följer' });
    expect(within(friends).getAllByText(/^Person f/)).toHaveLength(8);
    expect(within(friends).getByText('+2')).toBeInTheDocument();
    expect(within(following).getAllByText(/^Person g/)).toHaveLength(8);
    expect(within(following).getByText('+1')).toBeInTheDocument();
  });
});
