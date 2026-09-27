// src/components/groups/GroupWatchlistTable.test.tsx
//
// BIN-1308. A refused rating or removal must say so on its row and report to Sentry,
// rather than leave the row looking unchanged. Mocked Firestore: this pins the
// component's handling, not the rule.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { GroupWatchlistTable } from './GroupWatchlistTable';
import type { GroupMember, GroupWatchlistItem } from '@/types';

const setMemberRating = vi.hoisted(() => vi.fn());
const removeFromGroupWatchlist = vi.hoisted(() => vi.fn());
vi.mock('@/lib/firebase/groups', () => ({ setMemberRating, removeFromGroupWatchlist }));
const captureError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sentry', () => ({ captureError }));
vi.mock('@/hooks/useGroupMemberProgress', () => ({ useGroupMemberProgress: () => new Map() }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    <a href={href}>{children}</a>,
}));

const members = [
  { uid: 'me', displayName: 'Malin Test' },
  { uid: 'other', displayName: 'Anna Berg' },
] as GroupMember[];

const item = {
  tmdbId: 603,
  mediaType: 'movie',
  title: 'The Matrix',
  posterPath: null,
  releaseYear: 1999,
  addedBy: 'me',
  addedAt: new Date('2026-09-01'),
  memberRatings: {},
} as unknown as GroupWatchlistItem;

const otherItem = {
  ...item,
  tmdbId: 1399,
  mediaType: 'tv',
  title: 'Game of Thrones',
  addedAt: new Date('2026-08-01'),
} as unknown as GroupWatchlistItem;

function renderTable(watchlist: GroupWatchlistItem[] = [item]) {
  render(
    <GroupWatchlistTable groupId="g1" watchlist={watchlist} members={members} myUid="me" isOwner={false} />,
  );
}

function rowOf(title: string): HTMLElement {
  const row = screen.getByText(title).closest('tr');
  if (!row) throw new Error(`no row for ${title}`);
  return row;
}

function pickRating(n: string, title = 'The Matrix') {
  const row = rowOf(title);
  fireEvent.click(within(row).getByRole('button', { name: '+' }));
  fireEvent.click(within(row).getByRole('button', { name: n }));
}

function confirmRemoval(title = 'The Matrix') {
  fireEvent.click(within(rowOf(title)).getByTitle('Ta bort'));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ta bort' }));
}

describe('GroupWatchlistTable — a refused write (BIN-1308)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('a refused rating shows the failure and reports it under its own kind', async () => {
    const err = Object.assign(new Error('denied'), { code: 'permission-denied' });
    setMemberRating.mockRejectedValue(err);
    renderTable();
    pickRating('7');
    expect(await screen.findByRole('alert')).toHaveTextContent('Betyget sparades inte');
    expect(captureError).toHaveBeenCalledWith(err, { scope: 'groups', kind: 'groupWatchlistTable-rate' });
  });

  it('a successful rating shows no failure', async () => {
    setMemberRating.mockResolvedValue(undefined);
    renderTable();
    pickRating('7');
    await waitFor(() => expect(setMemberRating).toHaveBeenCalledWith({
      groupId: 'g1', mediaType: 'movie', tmdbId: 603, uid: 'me', rating: 7,
    }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(captureError).not.toHaveBeenCalled();
  });

  it('a refused removal shows the failure and reports it under its own kind', async () => {
    const err = Object.assign(new Error('denied'), { code: 'permission-denied' });
    removeFromGroupWatchlist.mockRejectedValue(err);
    renderTable();
    confirmRemoval();
    expect(await screen.findByRole('alert')).toHaveTextContent('Gick inte att ta bort');
    expect(captureError).toHaveBeenCalledWith(err, { scope: 'groups', kind: 'groupWatchlistTable-remove' });
  });

  it('a successful removal shows no failure', async () => {
    removeFromGroupWatchlist.mockResolvedValue(undefined);
    renderTable();
    confirmRemoval();
    await waitFor(() => expect(removeFromGroupWatchlist).toHaveBeenCalledWith('movie', 'g1', 603));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(captureError).not.toHaveBeenCalled();
  });

  it('a retried rating that succeeds clears the failure', async () => {
    setMemberRating.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    renderTable();
    pickRating('7');
    expect(await screen.findByRole('alert')).toHaveTextContent('Betyget sparades inte');
    pickRating('8');
    await waitFor(() => expect(setMemberRating).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('a retried removal that succeeds clears the failure', async () => {
    removeFromGroupWatchlist.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    renderTable();
    confirmRemoval();
    expect(await screen.findByRole('alert')).toHaveTextContent('Gick inte att ta bort');
    confirmRemoval();
    await waitFor(() => expect(removeFromGroupWatchlist).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('a successful write on another row leaves the first row failure showing', async () => {
    setMemberRating.mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
    removeFromGroupWatchlist.mockResolvedValue(undefined);
    renderTable([item, otherItem]);
    pickRating('7', 'The Matrix');
    expect(await within(rowOf('The Matrix')).findByRole('alert')).toHaveTextContent('Betyget sparades inte');
    pickRating('5', 'Game of Thrones');
    await waitFor(() => expect(setMemberRating).toHaveBeenCalledTimes(2));
    confirmRemoval('Game of Thrones');
    await waitFor(() => expect(removeFromGroupWatchlist).toHaveBeenCalledWith('tv', 'g1', 1399));
    expect(within(rowOf('The Matrix')).getByRole('alert')).toHaveTextContent('Betyget sparades inte');
    expect(within(rowOf('Game of Thrones')).queryByRole('alert')).toBeNull();
  });

  it('two rows that both fail each keep their own failure', async () => {
    setMemberRating.mockRejectedValue(new Error('denied'));
    renderTable([item, otherItem]);
    pickRating('7', 'The Matrix');
    expect(await within(rowOf('The Matrix')).findByRole('alert')).toHaveTextContent('Betyget sparades inte');
    pickRating('5', 'Game of Thrones');
    expect(await within(rowOf('Game of Thrones')).findByRole('alert')).toHaveTextContent('Betyget sparades inte');
    expect(within(rowOf('The Matrix')).getByRole('alert')).toHaveTextContent('Betyget sparades inte');
  });
});
