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
vi.mock('@/lib/firebase/groups', () => ({ addToGroupWatchlist, removeFromGroupWatchlist, hasInGroupWatchlist }));
const captureError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sentry', () => ({ captureError }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'me' }) }));
vi.mock('@/hooks/useGroups', () => ({ useMyGroups: () => ({ groups: [{ id: 'g1', name: 'Fredagsmys' }] }) }));

function renderButton() {
  render(<AddToGroupButton tmdbId={603} mediaType="movie" title="The Matrix" posterPath="/m.jpg" releaseYear={1999} />);
}

async function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /Grupp/ }));
  return screen.findByRole('button', { name: /Fredagsmys/ });
}

describe('AddToGroupButton — a refused write (BIN-1298)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    hasInGroupWatchlist.mockResolvedValue(false);
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
