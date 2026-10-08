// src/components/groups/GroupWatchlistTable.test.tsx
//
// BIN-1308. A refused rating or removal must say so on its row and report to Sentry,
// rather than leave the row looking unchanged. Mocked Firestore: this pins the
// component's handling, not the rule.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { GroupWatchlistTable } from './GroupWatchlistTable';
import type { GroupMember } from '@/types';
import type { GroupWatchlistRow } from '@/lib/firebase/groups';

const setMemberRating = vi.hoisted(() => vi.fn());
const removeFromGroupWatchlist = vi.hoisted(() => vi.fn());
vi.mock('@/lib/firebase/groups', () => ({ setMemberRating, removeFromGroupWatchlist }));
const captureError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sentry', () => ({ captureError }));
// The real `watchlistDocToObject` is loaded below via importActual; its module reaches
// for Firestore only through `./db`, which is stubbed so no SDK loads.
vi.mock('@/lib/firebase/db', () => ({ fsdb: vi.fn(), lazySubscribe: vi.fn() }));
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
  addedAtKnown: true,
  memberRatings: {},
} as unknown as GroupWatchlistRow;

const otherItem = {
  ...item,
  tmdbId: 1399,
  mediaType: 'tv',
  title: 'Game of Thrones',
  addedAt: new Date('2026-08-01'),
} as unknown as GroupWatchlistRow;

function renderTable(watchlist: GroupWatchlistRow[] = [item]) {
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

  it('a refused "Rensa" (rating null) shows the failure on the row and reports it under the rate kind (BIN-1314)', async () => {
    const err = Object.assign(new Error('denied'), { code: 'permission-denied' });
    setMemberRating.mockRejectedValue(err);
    renderTable();
    pickRating('Rensa');
    await waitFor(() => expect(setMemberRating).toHaveBeenCalledWith({
      groupId: 'g1', mediaType: 'movie', tmdbId: 603, uid: 'me', rating: null,
    }));
    expect(await within(rowOf('The Matrix')).findByRole('alert')).toHaveTextContent('Betyget sparades inte');
    expect(captureError).toHaveBeenCalledWith(err, { scope: 'groups', kind: 'groupWatchlistTable-rate' });
  });

  it('an older rating refused after a newer one saved shows no failure (BIN-1315)', async () => {
    let rejectFirst!: (e: unknown) => void;
    setMemberRating
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce(undefined);
    renderTable();
    pickRating('7');
    pickRating('8');
    await waitFor(() => expect(setMemberRating).toHaveBeenCalledTimes(2));
    rejectFirst(new Error('denied'));
    await waitFor(() => expect(captureError).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an older rating saved after a newer one was refused keeps the failure (BIN-1315)', async () => {
    let resolveFirst!: () => void;
    setMemberRating
      .mockImplementationOnce(() => new Promise<void>(resolve => { resolveFirst = resolve; }))
      .mockRejectedValueOnce(new Error('denied'));
    renderTable();
    pickRating('7');
    pickRating('8');
    expect(await screen.findByRole('alert')).toHaveTextContent('Betyget sparades inte');
    resolveFirst();
    await new Promise(r => setTimeout(r, 0));
    expect(screen.getByRole('alert')).toHaveTextContent('Betyget sparades inte');
  });

  it('a removal on the same row leaves its rating failure showing (BIN-1315)', async () => {
    setMemberRating.mockRejectedValue(new Error('denied'));
    removeFromGroupWatchlist.mockResolvedValue(undefined);
    renderTable();
    pickRating('7');
    expect(await screen.findByRole('alert')).toHaveTextContent('Betyget sparades inte');
    confirmRemoval();
    await waitFor(() => expect(removeFromGroupWatchlist).toHaveBeenCalledWith('movie', 'g1', 603));
    expect(within(rowOf('The Matrix')).getByRole('alert')).toHaveTextContent('Betyget sparades inte');
  });

  it('a refused removal on a row with a rating failure shows both failures at once (BIN-1315)', async () => {
    setMemberRating.mockRejectedValue(new Error('denied'));
    removeFromGroupWatchlist.mockRejectedValue(new Error('denied'));
    renderTable();
    pickRating('7');
    expect(await within(rowOf('The Matrix')).findByRole('alert')).toHaveTextContent('Betyget sparades inte');
    confirmRemoval();
    expect(await within(rowOf('The Matrix')).findByText('Gick inte att ta bort')).toBeInTheDocument();
    const alerts = within(rowOf('The Matrix')).getAllByRole('alert').map(a => a.textContent);
    expect(alerts).toEqual(expect.arrayContaining(['Betyget sparades inte', 'Gick inte att ta bort']));
    expect(alerts).toHaveLength(2);
  });

  it('a rating attempt, saved or refused, leaves the row removal failure showing (BIN-1315)', async () => {
    removeFromGroupWatchlist.mockRejectedValue(new Error('denied'));
    setMemberRating.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    renderTable();
    confirmRemoval();
    expect(await within(rowOf('The Matrix')).findByRole('alert')).toHaveTextContent('Gick inte att ta bort');
    pickRating('7');
    await waitFor(() => expect(setMemberRating).toHaveBeenCalledTimes(1));
    await new Promise(r => setTimeout(r, 0));
    const afterSaved = within(rowOf('The Matrix')).getAllByRole('alert').map(a => a.textContent);
    expect(afterSaved).toEqual(['Gick inte att ta bort']);
    pickRating('8');
    expect(await within(rowOf('The Matrix')).findByText('Betyget sparades inte')).toBeInTheDocument();
    const afterRefused = within(rowOf('The Matrix')).getAllByRole('alert').map(a => a.textContent);
    expect(afterRefused).toEqual(expect.arrayContaining(['Betyget sparades inte', 'Gick inte att ta bort']));
    expect(afterRefused).toHaveLength(2);
  });

  it('an older removal refused after a newer one succeeded shows no failure (BIN-1330)', async () => {
    let rejectFirst!: (e: unknown) => void;
    removeFromGroupWatchlist
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce(undefined);
    renderTable();
    confirmRemoval();
    confirmRemoval();
    await waitFor(() => expect(removeFromGroupWatchlist).toHaveBeenCalledTimes(2));
    await new Promise(r => setTimeout(r, 0));
    rejectFirst(new Error('denied'));
    await waitFor(() => expect(captureError).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an older removal saved after a newer one was refused keeps the failure (BIN-1330)', async () => {
    let resolveFirst!: () => void;
    removeFromGroupWatchlist
      .mockImplementationOnce(() => new Promise<void>(resolve => { resolveFirst = resolve; }))
      .mockRejectedValueOnce(new Error('denied'));
    renderTable();
    confirmRemoval();
    confirmRemoval();
    expect(await screen.findByRole('alert')).toHaveTextContent('Gick inte att ta bort');
    resolveFirst();
    await new Promise(r => setTimeout(r, 0));
    expect(screen.getByRole('alert')).toHaveTextContent('Gick inte att ta bort');
  });
});

// BIN-1333. The watchlist prop is what Firestore's listener hands the table, so these
// drive it by rerendering with a new array: a row that leaves and comes back.
describe('GroupWatchlistTable — failures follow the row out of the watchlist (BIN-1333)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  function renderWith(watchlist: GroupWatchlistRow[]) {
    const view = render(
      <GroupWatchlistTable groupId="g1" watchlist={watchlist} members={members} myUid="me" isOwner={false} />,
    );
    return (next: GroupWatchlistRow[]) => view.rerender(
      <GroupWatchlistTable groupId="g1" watchlist={next} members={members} myUid="me" isOwner={false} />,
    );
  }

  it('a row removed and added again comes back without its old removal failure', async () => {
    removeFromGroupWatchlist.mockRejectedValue(new Error('denied'));
    const setWatchlist = renderWith([item, otherItem]);
    confirmRemoval();
    expect(await within(rowOf('The Matrix')).findByRole('alert')).toHaveTextContent('Gick inte att ta bort');
    setWatchlist([otherItem]);
    setWatchlist([{ ...item }, otherItem]);
    expect(within(rowOf('The Matrix')).queryByRole('alert')).toBeNull();
  });

  it('a row removed and added again comes back without its old rating failure', async () => {
    setMemberRating.mockRejectedValue(new Error('denied'));
    const setWatchlist = renderWith([item]);
    pickRating('7');
    expect(await screen.findByRole('alert')).toHaveTextContent('Betyget sparades inte');
    setWatchlist([]);
    setWatchlist([{ ...item }]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('another row leaving the watchlist leaves this row failure showing', async () => {
    setMemberRating.mockRejectedValue(new Error('denied'));
    const setWatchlist = renderWith([item, otherItem]);
    pickRating('7');
    expect(await within(rowOf('The Matrix')).findByRole('alert')).toHaveTextContent('Betyget sparades inte');
    setWatchlist([item]);
    expect(within(rowOf('The Matrix')).getByRole('alert')).toHaveTextContent('Betyget sparades inte');
  });

  it('a refused removal whose row was hidden while it waited shows the failure when the row returns', async () => {
    let rejectRemoval!: (e: unknown) => void;
    removeFromGroupWatchlist.mockImplementationOnce(() => new Promise((_, reject) => { rejectRemoval = reject; }));
    const setWatchlist = renderWith([item, otherItem]);
    confirmRemoval();
    await waitFor(() => expect(removeFromGroupWatchlist).toHaveBeenCalledTimes(1));
    setWatchlist([otherItem]);
    rejectRemoval(new Error('denied'));
    await waitFor(() => expect(captureError).toHaveBeenCalledTimes(1));
    setWatchlist([{ ...otherItem }]);
    setWatchlist([{ ...item }, otherItem]);
    expect(within(rowOf('The Matrix')).getByRole('alert')).toHaveTextContent('Gick inte att ta bort');
  });
});

// BIN-1350. A re-add writes a fresh `addedAt`; a row Firestore restores after a
// refused removal keeps its old one. That is what these vary.
describe('GroupWatchlistTable — a title added again starts without the old failure (BIN-1350)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  function renderWith(watchlist: GroupWatchlistRow[]) {
    const view = render(
      <GroupWatchlistTable groupId="g1" watchlist={watchlist} members={members} myUid="me" isOwner={false} />,
    );
    return (next: GroupWatchlistRow[]) => view.rerender(
      <GroupWatchlistTable groupId="g1" watchlist={next} members={members} myUid="me" isOwner={false} />,
    );
  }

  const readded = { ...item, addedAt: new Date('2026-09-20') } as GroupWatchlistRow;

  function pendingRemoval() {
    let settle!: { resolve: () => void; reject: (e: unknown) => void };
    removeFromGroupWatchlist.mockImplementationOnce(
      () => new Promise<void>((resolve, reject) => { settle = { resolve, reject }; }),
    );
    return () => settle;
  }

  it('a removal refused while its row was hidden does not show on the title added again', async () => {
    const settle = pendingRemoval();
    const setWatchlist = renderWith([item, otherItem]);
    confirmRemoval();
    await waitFor(() => expect(removeFromGroupWatchlist).toHaveBeenCalledTimes(1));
    setWatchlist([otherItem]);
    settle().reject(new Error('denied'));
    await waitFor(() => expect(captureError).toHaveBeenCalledTimes(1));
    setWatchlist([readded, otherItem]);
    expect(within(rowOf('The Matrix')).queryByRole('alert')).toBeNull();
  });

  it('a rating refused while its row was hidden does not show on the title added again', async () => {
    let rejectRating!: (e: unknown) => void;
    setMemberRating.mockImplementationOnce(() => new Promise((_, reject) => { rejectRating = reject; }));
    const setWatchlist = renderWith([item, otherItem]);
    pickRating('7');
    await waitFor(() => expect(setMemberRating).toHaveBeenCalledTimes(1));
    setWatchlist([otherItem]);
    rejectRating(new Error('denied'));
    await waitFor(() => expect(captureError).toHaveBeenCalledTimes(1));
    setWatchlist([readded, otherItem]);
    expect(within(rowOf('The Matrix')).queryByRole('alert')).toBeNull();
  });

  it('a removal still pending when the title is added again shows its own refusal', async () => {
    const settle = pendingRemoval();
    const setWatchlist = renderWith([item, otherItem]);
    confirmRemoval();
    await waitFor(() => expect(removeFromGroupWatchlist).toHaveBeenCalledTimes(1));
    setWatchlist([otherItem]);
    setWatchlist([readded, otherItem]);
    settle().reject(new Error('denied'));
    expect(await within(rowOf('The Matrix')).findByRole('alert')).toHaveTextContent('Gick inte att ta bort');
  });

  it('a removal still pending when the title is added again shows no failure once it is saved', async () => {
    const settle = pendingRemoval();
    const setWatchlist = renderWith([item, otherItem]);
    confirmRemoval();
    await waitFor(() => expect(removeFromGroupWatchlist).toHaveBeenCalledTimes(1));
    setWatchlist([otherItem]);
    setWatchlist([readded, otherItem]);
    settle().resolve();
    await waitFor(() => expect(within(rowOf('The Matrix')).queryByRole('alert')).toBeNull());
    expect(captureError).not.toHaveBeenCalled();
  });
});

// BIN-1354. An older row saved without `addedAt` is read with a stand-in date that
// moves on every snapshot (`addedAtKnown: false`), so each snapshot below hands the
// table a different stand-in, as the real listener does.
describe('GroupWatchlistTable — a row without a stored addedAt (BIN-1354)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  function renderWith(watchlist: GroupWatchlistRow[]) {
    const view = render(
      <GroupWatchlistTable groupId="g1" watchlist={watchlist} members={members} myUid="me" isOwner={false} />,
    );
    return (next: GroupWatchlistRow[]) => view.rerender(
      <GroupWatchlistTable groupId="g1" watchlist={next} members={members} myUid="me" isOwner={false} />,
    );
  }

  const undated = (standIn: string) =>
    ({ ...item, addedAt: new Date(standIn), addedAtKnown: false }) as GroupWatchlistRow;

  it('a removal refused while the undated row was hidden shows the failure when Firestore restores it', async () => {
    let rejectRemoval!: (e: unknown) => void;
    removeFromGroupWatchlist.mockImplementationOnce(() => new Promise((_, reject) => { rejectRemoval = reject; }));
    const setWatchlist = renderWith([undated('2026-09-30T10:00:00Z'), otherItem]);
    confirmRemoval();
    await waitFor(() => expect(removeFromGroupWatchlist).toHaveBeenCalledTimes(1));
    setWatchlist([otherItem]);
    rejectRemoval(new Error('denied'));
    await waitFor(() => expect(captureError).toHaveBeenCalledTimes(1));
    setWatchlist([undated('2026-09-30T10:00:05Z'), otherItem]);
    expect(within(rowOf('The Matrix')).getByRole('alert')).toHaveTextContent('Gick inte att ta bort');
    setWatchlist([undated('2026-09-30T10:00:09Z'), { ...otherItem }]);
    expect(within(rowOf('The Matrix')).getByRole('alert')).toHaveTextContent('Gick inte att ta bort');
  });

  it('a removal refused while the undated row was hidden does not show once the title is added again with a stamp', async () => {
    let rejectRemoval!: (e: unknown) => void;
    removeFromGroupWatchlist.mockImplementationOnce(() => new Promise((_, reject) => { rejectRemoval = reject; }));
    const setWatchlist = renderWith([undated('2026-09-30T10:00:00Z'), otherItem]);
    confirmRemoval();
    await waitFor(() => expect(removeFromGroupWatchlist).toHaveBeenCalledTimes(1));
    setWatchlist([otherItem]);
    rejectRemoval(new Error('denied'));
    await waitFor(() => expect(captureError).toHaveBeenCalledTimes(1));
    // The re-add's server stamp is still pending, then arrives.
    setWatchlist([undated('2026-09-30T10:00:05Z'), otherItem]);
    setWatchlist([{ ...item, addedAt: new Date('2026-09-30T10:00:06Z') }, otherItem]);
    expect(within(rowOf('The Matrix')).queryByRole('alert')).toBeNull();
  });

  it('a removal refused while a dated row was hidden does not show on the re-add whose stamp is still pending', async () => {
    let rejectRemoval!: (e: unknown) => void;
    removeFromGroupWatchlist.mockImplementationOnce(() => new Promise((_, reject) => { rejectRemoval = reject; }));
    const setWatchlist = renderWith([item, otherItem]);
    confirmRemoval();
    await waitFor(() => expect(removeFromGroupWatchlist).toHaveBeenCalledTimes(1));
    setWatchlist([otherItem]);
    rejectRemoval(new Error('denied'));
    await waitFor(() => expect(captureError).toHaveBeenCalledTimes(1));
    setWatchlist([undated('2026-09-30T10:00:05Z'), otherItem]);
    expect(within(rowOf('The Matrix')).queryByRole('alert')).toBeNull();
  });
});

// BIN-1354. The producer of `addedAtKnown`, which the fixtures above set by hand.
// Mirrors the `memberDocToObject` joinedAtKnown suite in groups.test.ts (BIN-1118).
describe('watchlistDocToObject — addedAtKnown follows the RAW field (BIN-1354)', () => {
  async function load() {
    const actual = await vi.importActual<typeof import('@/lib/firebase/groups')>('@/lib/firebase/groups');
    return actual.watchlistDocToObject;
  }
  const stamp = (d: Date) => ({ toDate: () => d });

  it('a Timestamp-like stamp is known, and addedAt is its date', async () => {
    const watchlistDocToObject = await load();
    const row = watchlistDocToObject('603', { addedAt: stamp(new Date('2026-09-01')) });
    expect(row.addedAtKnown).toBe(true);
    expect(row.addedAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('a real Date is known', async () => {
    const watchlistDocToObject = await load();
    expect(watchlistDocToObject('603', { addedAt: new Date('2026-09-01') }).addedAtKnown).toBe(true);
  });

  it.each([
    ['missing', {}],
    ['null (a pending serverTimestamp)', { addedAt: null }],
    ['a number', { addedAt: 1756684800000 }],
    ['a string', { addedAt: '2026-09-01' }],
    ['a toDate that is not a function', { addedAt: { toDate: 'not a function' } }],
  ])('addedAt %s is unknown, and addedAt is still a Date', async (_label, data) => {
    const watchlistDocToObject = await load();
    const row = watchlistDocToObject('603', data as Record<string, unknown>);
    expect(row.addedAtKnown).toBe(false);
    expect(row.addedAt).toBeInstanceOf(Date);
  });
});
