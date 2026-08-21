// src/components/watchlist/VillSePickerPage.test.tsx
//
// BIN-942. One proposition, and it is the one two reviewers blocked this batch on:
// "Redan sett" must not confirm a write Firestore refused.
//
// `updateStatus` swallows exactly one refusal — the create-floor saying no because the title
// was deleted between the snapshot this call read and the write landing — and then RESOLVES.
// Before this test the toast fired unconditionally, so in that race the user was told
// "Markerad som sedd: X" about a write that never happened. That is the same false
// confirmation BIN-895 closed for the add path ("a rejected write never reports a count …
// the toast cannot describe something Firestore refused"), reopened one door over, because
// `updateStatus` had become a quiet path this caller did not know was quiet.
//
// The negative case alone would pass against a page that never toasts at all, so the positive
// control sits beside it — that is the failure mode "just delete the toast" would have.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import VillSePickerPage from './VillSePickerPage';
import type { WatchlistItem } from '@/types';
import type { ItemWriteOutcome } from '@/contexts/WatchlistContext';

const toast = vi.hoisted(() => vi.fn());
const updateStatus = vi.hoisted(() =>
  vi.fn<(mediaType: string, tmdbId: number, status: string) => Promise<ItemWriteOutcome>>(
    async () => 'written',
  ),
);
const state = vi.hoisted(() => ({ items: [] as WatchlistItem[], loading: false }));

vi.mock('@/hooks/useWatchlist', () => ({
  useWatchlist: () => ({ items: state.items, loading: state.loading, updateStatus }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { myProviders: [] } }) }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));
// The subnav pulls the whole library page in; it renders nothing this test asserts on.
vi.mock('@/components/WatchlistPage', () => ({ LibrarySubnav: () => null }));

/** A film in 'vill_se' — the only shape that renders the "Redan sett" button. */
function film(over: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    tmdbId: 603, mediaType: 'movie', status: 'vill_se', title: 'The Matrix',
    posterPath: null, releaseYear: 1999, rating: null, notes: null, tags: [],
    providers: [], subscriptionProviders: [], genreIds: [], runtime: 136,
    ...over,
  } as unknown as WatchlistItem;
}

beforeEach(() => {
  vi.clearAllMocks();
  updateStatus.mockResolvedValue('written');
  state.items = [film()];
  state.loading = false;
});

async function clickRedanSett() {
  render(<VillSePickerPage />);
  await act(async () => { fireEvent.click(screen.getByText('Redan sett')); });
}

describe('VillSePickerPage — "Redan sett" only confirms a write that landed (BIN-942)', () => {
  it('says nothing when the create-floor refused the write', async () => {
    updateStatus.mockResolvedValueOnce('refused');
    await clickRedanSett();

    // The write was attempted — this is not a "the button did nothing" pass.
    expect(updateStatus).toHaveBeenCalledWith('movie', 603, 'sedd');
    // ...and nothing was claimed about it. The card leaves the list anyway, because the
    // title is gone entirely, so the disappearance is the whole feedback.
    expect(toast).not.toHaveBeenCalled();
  });

  it('confirms in words when the write landed', async () => {
    await clickRedanSett();

    expect(updateStatus).toHaveBeenCalledWith('movie', 603, 'sedd');
    expect(toast).toHaveBeenCalledWith('Markerad som sedd: The Matrix');
  });
});
