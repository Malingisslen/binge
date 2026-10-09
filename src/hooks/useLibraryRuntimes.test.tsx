import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { WatchlistItem } from '@/types';

const getMovieLite = vi.hoisted(() => vi.fn(async () => ({ runtime: 101 })));
const getTVShowLite = vi.hoisted(() => vi.fn(async () => ({ episode_run_time: [], last_episode_to_air: { runtime: 24 } })));
vi.mock('@/lib/tmdb/client', () => ({ getMovieLite, getTVShowLite }));

import { useLibraryRuntimes } from './useLibraryRuntimes';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const item = (o: Partial<WatchlistItem>) => ({ tmdbId: 1, mediaType: 'movie', runtime: null, ...o } as WatchlistItem);

describe('useLibraryRuntimes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches nothing while the length filter is off', () => {
    renderHook(() => useLibraryRuntimes([item({})], false), { wrapper });
    expect(getMovieLite).not.toHaveBeenCalled();
  });

  it('uses a stored runtime without fetching, and looks up only the titles saved without one', async () => {
    const stored = item({ tmdbId: 1, runtime: 88 });
    const missingFilm = item({ tmdbId: 2 });
    const missingSeries = item({ tmdbId: 3, mediaType: 'tv' });
    const { result } = renderHook(() => useLibraryRuntimes([stored, missingFilm, missingSeries], true), { wrapper });
    expect(result.current.runtimeOf(stored)).toBe(88);
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(getMovieLite).toHaveBeenCalledTimes(1);
    expect(getMovieLite).toHaveBeenCalledWith(2, expect.anything());
    expect(result.current.runtimeOf(missingFilm)).toBe(101);
    // A series without episode_run_time falls back to its latest episode's length.
    expect(result.current.runtimeOf(missingSeries)).toBe(24);
  });

  it('counts a lookup that failed as settled, so the wait ends, and leaves its runtime unknown', async () => {
    getMovieLite.mockImplementationOnce(async () => { throw new Error('TMDB API error: 500'); });
    const failing = item({ tmdbId: 5 });
    const fine = item({ tmdbId: 6 });
    const { result } = renderHook(() => useLibraryRuntimes([failing, fine], true), { wrapper });
    expect(result.current.needed).toBe(2);
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.settled).toBe(2);
    expect(result.current.runtimeOf(failing)).toBeNull();
    expect(result.current.runtimeOf(fine)).toBe(101);
  });
});
