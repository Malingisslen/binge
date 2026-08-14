// src/app/settings/import/page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import ImportPage from './page';
import type { WatchlistItem } from '@/types';

// BIN-729 — the CSV importer is the most destructive write left in the app after
// BIN-596: it hard-writes `status` row after row, and `status` is the one field
// no payload shape can protect. Its only defence against overwriting titles the
// user already has is the dedup, and the dedup is `getItem`.
//
// On a dead listener `getItem` answers null for EVERY title, so every row reads
// as new and a 1000-row import can demote a whole library. `loading` cannot see
// that state (it goes false both when the snapshot lands and when the listener
// dies), which is why the gate is `libraryKnown`.
//
// The analysis is gated too, not just the write: its `duplicate` verdict IS the
// dedup, and the user's confirmation of that list is what the page treats as
// consent to write.

const watchlist = vi.hoisted(() => ({
  getItem: vi.fn<(mediaType: string, tmdbId: number) => WatchlistItem | null>(() => null),
  upsertTitle: vi.fn<(payload: { tmdbId: number; status: string }) => Promise<void>>(async () => {}),
  // Derived exactly as the provider derives it — a hardcoded literal would let
  // this file assert a state production cannot produce.
  snapshotSettled: true,
  listenerFailed: false,
  get libraryKnown(): boolean { return this.snapshotSettled && !this.listenerFailed; },
  retryListener: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());
const searchMulti = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => watchlist }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: toast }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));
// The page is behind AuthGuard in production; these tests are about the library
// gate, so the auth gate renders through.
vi.mock('@/components/AuthGuard', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/tmdb/client', () => ({
  searchMulti,
  findByImdbId: vi.fn(async () => null),
  posterUrl: () => null,
}));

const CSV = [
  'Date,Name,Year,Letterboxd URI,Rating',
  '2024-01-01,The Matrix,1999,https://boxd.it/x,4.5',
].join('\n');

const MATCH = {
  id: 603,
  media_type: 'movie',
  title: 'The Matrix',
  release_date: '1999-03-31',
  poster_path: null,
  genre_ids: [28],
};

const ANALYZE = 'Analysera mot TMDB';

/** jsdom's File.text() is not dependable across versions — pin it explicitly. */
function csvFile(text = CSV) {
  const file = new File([text], 'letterboxd.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => text });
  return file;
}

async function pickFile() {
  const view = render(<ImportPage />);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => { fireEvent.change(input, { target: { files: [csvFile()] } }); });
  // Parsing landed → the analyse step exists to be gated.
  await waitFor(() => expect(screen.getByRole('button', { name: ANALYZE })).toBeInTheDocument());
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  watchlist.snapshotSettled = true;
  watchlist.listenerFailed = false;
  watchlist.getItem.mockReturnValue(null);
  searchMulti.mockResolvedValue({ results: [MATCH] });
});

describe('BIN-729 — the CSV import waits for a known library', () => {
  it('imports normally once the library is known — the control', async () => {
    // Without this, a page that rendered nothing would satisfy every negative
    // assertion below.
    await pickFile();

    expect(screen.getByRole('button', { name: ANALYZE })).not.toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: ANALYZE })); });

    const importBtn = await screen.findByRole('button', { name: /Importera 1 titlar/ });
    await act(async () => { fireEvent.click(importBtn); });
    expect(watchlist.upsertTitle).toHaveBeenCalledTimes(1);
    expect(watchlist.upsertTitle.mock.calls[0][0]).toMatchObject({ tmdbId: 603, status: 'sedd' });
  });

  it('skips a title already in the library — the dedup the gate protects', async () => {
    watchlist.getItem.mockReturnValue({ tmdbId: 603, mediaType: 'movie', status: 'vill_se' } as WatchlistItem);
    await pickFile();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: ANALYZE })); });

    // Twice: once in the summary count, once on the row itself.
    expect(await screen.findAllByText(/redan i biblioteket/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Importera/ })).not.toBeInTheDocument();
  });

  it('holds the analysis while the first snapshot is in flight', async () => {
    watchlist.snapshotSettled = false;
    await pickFile();

    expect(screen.getByRole('button', { name: ANALYZE })).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: ANALYZE })); });
    // Nothing was matched, so nothing can be imported — and nothing was written.
    expect(searchMulti).not.toHaveBeenCalled();
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
    expect(screen.getByText(/Läser in ditt bibliotek/)).toBeInTheDocument();
  });

  it('holds it on a dead listener, says so, and offers a retry', async () => {
    // The state the ticket is about: getItem would answer null for the user's
    // whole library, so every row would import as new and overwrite its status.
    watchlist.listenerFailed = true;
    await pickFile();

    expect(screen.getByRole('button', { name: ANALYZE })).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: ANALYZE })); });
    expect(searchMulti).not.toHaveBeenCalled();
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();

    expect(screen.getByRole('alert')).toHaveTextContent(/Vi når inte ditt bibliotek/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Försök igen' })); });
    expect(watchlist.retryListener).toHaveBeenCalledTimes(1);
  });

  it('withdraws the import when the listener dies AFTER the analysis', async () => {
    // The analysis is a dry run the user confirms separately, so the confirmed
    // list can outlive the library state it was computed against — its
    // "duplicate" verdicts are now unverifiable and every row would be written
    // as new.
    const view = await pickFile();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: ANALYZE })); });
    const importBtn = await screen.findByRole('button', { name: /Importera 1 titlar/ });
    expect(importBtn).not.toBeDisabled();

    watchlist.listenerFailed = true;
    await act(async () => { view.rerender(<ImportPage />); });

    expect(screen.getByRole('button', { name: /Importera 1 titlar/ })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Vi når inte ditt bibliotek/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Importera 1 titlar/ })); });
    expect(watchlist.upsertTitle).not.toHaveBeenCalled();
  });
});
