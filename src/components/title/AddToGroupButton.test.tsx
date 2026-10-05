// src/components/title/AddToGroupButton.test.tsx
//
// BIN-1298. The group watchlist rule now refuses a write it does not recognise, so
// the button must report a failed toggle rather than leave the row looking unchanged.
// Mocked Firestore: this pins the component's handling, not the rule.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddToGroupButton from './AddToGroupButton';

const addToGroupWatchlist = vi.hoisted(() => vi.fn());
const removeFromGroupWatchlist = vi.hoisted(() => vi.fn());
const hasInGroupWatchlist = vi.hoisted(() => vi.fn());
const getMyGroupIds = vi.hoisted(() => vi.fn());
vi.mock('@/lib/firebase/groups', () => ({ addToGroupWatchlist, removeFromGroupWatchlist, hasInGroupWatchlist, getMyGroupIds }));
const captureError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sentry', () => ({ captureError }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'me' }) }));
// PERF-6: the live list only exists while the hook is enabled, as in production.
const useMyGroups = vi.hoisted(() => vi.fn((_uid: string | null, opts?: { enabled?: boolean }) =>
  opts?.enabled === false
    ? { groups: [], loading: true }
    : { groups: [{ id: 'g1', name: 'Fredagsmys' }], loading: false }));
vi.mock('@/hooks/useGroups', () => ({ useMyGroups }));

function renderButton() {
  render(<AddToGroupButton tmdbId={603} mediaType="movie" title="The Matrix" posterPath="/m.jpg" releaseYear={1999} />);
}

async function openMenu() {
  fireEvent.click(await screen.findByRole('button', { name: /Grupp/ }));
  return screen.findByRole('button', { name: /Fredagsmys/ });
}

describe('AddToGroupButton — a refused write (BIN-1298)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    hasInGroupWatchlist.mockResolvedValue(false);
    getMyGroupIds.mockResolvedValue(['g1']);
  });

  it('a refused add shows the failure and reports it', async () => {
    const err = Object.assign(new Error('denied'), { code: 'permission-denied' });
    addToGroupWatchlist.mockRejectedValue(err);
    renderButton();
    fireEvent.click(await openMenu());
    expect(await screen.findByRole('alert')).toHaveTextContent('Gick inte');
    expect(captureError).toHaveBeenCalledWith(err, { scope: 'groups', kind: 'groupWatchlist-add' });
  });

  it('a successful add shows no failure', async () => {
    addToGroupWatchlist.mockResolvedValue(undefined);
    renderButton();
    fireEvent.click(await openMenu());
    await waitFor(() => expect(addToGroupWatchlist).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(captureError).not.toHaveBeenCalled();
  });
});

describe('AddToGroupButton — no live group listener until the menu opens (PERF-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasInGroupWatchlist.mockResolvedValue(false);
  });

  it('shows the button from the cached id read, with the live listener still closed', async () => {
    getMyGroupIds.mockResolvedValue(['g1']);
    renderButton();
    await screen.findByRole('button', { name: /Grupp/ });
    expect(getMyGroupIds).toHaveBeenCalledWith('me');
    expect(useMyGroups.mock.calls.every(([, opts]) => opts?.enabled === false)).toBe(true);
  });

  it('opening the menu opens the live listener and lists the groups', async () => {
    getMyGroupIds.mockResolvedValue(['g1']);
    renderButton();
    await openMenu();
    expect(useMyGroups).toHaveBeenLastCalledWith('me', { enabled: true });
  });

  it('a user with no groups sees no button', async () => {
    getMyGroupIds.mockResolvedValue([]);
    renderButton();
    await waitFor(() => expect(getMyGroupIds).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: /Grupp/ })).toBeNull();
  });

  it('a failed id read still shows the button, and the menu reads live', async () => {
    getMyGroupIds.mockRejectedValue(new Error('unavailable'));
    renderButton();
    expect(await openMenu()).toBeTruthy();
  });
});
