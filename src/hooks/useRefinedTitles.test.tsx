import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { RowTitle } from '@/types';

// Each fetch waits on a gate the test opens, so the loading state can be observed.
let waiting: Array<() => void> = [];
const gate = () => new Promise<void>(r => { waiting.push(r); });
const releaseAll = () => { waiting.forEach(r => r()); waiting = []; };
const getMovieLite = vi.hoisted(() => vi.fn());
const getTVShowLite = vi.hoisted(() => vi.fn());
const getWatchProviders = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tmdb/client', () => ({ getMovieLite, getTVShowLite, getWatchProviders }));

import { useRefinedTitles } from './useRefinedTitles';
import { NO_REFINEMENT } from '@/lib/recommendations/refineTitles';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const film = (id: number) => ({ id, media_type: 'movie', title: `F${id}`, vote_average: 7, genre_ids: [] } as unknown as RowTitle);
const items = [film(1), film(2)];

describe('useRefinedTitles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waiting = [];
    getMovieLite.mockImplementation(async (id: number) => { await gate(); return { runtime: id === 1 ? 85 : 140 }; });
    getWatchProviders.mockImplementation(async () => ({ results: {} }));
  });

  it('fetches nothing while no service or length filter is on', () => {
    const { result } = renderHook(() => useRefinedTitles(items, NO_REFINEMENT), { wrapper });
    expect(getMovieLite).not.toHaveBeenCalled();
    expect(getWatchProviders).not.toHaveBeenCalled();
    expect(result.current.items).toBe(items);
    expect(result.current.pending).toBe(false);
  });

  it('a length filter fetches each runtime, is pending until they land, then keeps what fits', async () => {
    const r = { ...NO_REFINEMENT, length: 'film-90' as const };
    const { result } = renderHook(() => useRefinedTitles(items, r), { wrapper });
    await waitFor(() => expect(getMovieLite).toHaveBeenCalledTimes(2));
    expect(result.current.pending).toBe(true);
    expect(result.current.items).toEqual([]);
    releaseAll();
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.items.map(t => t.id)).toEqual([1]);
    expect(getWatchProviders).not.toHaveBeenCalled();
  });

  it('a service filter fetches offers, not runtimes', async () => {
    const r = { ...NO_REFINEMENT, providerIds: [8] };
    renderHook(() => useRefinedTitles(items, r), { wrapper });
    await waitFor(() => expect(getWatchProviders).toHaveBeenCalledTimes(2));
    expect(getMovieLite).not.toHaveBeenCalled();
  });
});
