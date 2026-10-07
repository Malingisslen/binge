import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { DEFAULT_FILTERS, type RowSpec } from '@/types';

const discoverMovies = vi.hoisted(() => vi.fn<(params: Record<string, string>) => Promise<{ results: never[] }>>(async () => ({ results: [] })));
const discoverTV = vi.hoisted(() => vi.fn<(params: Record<string, string>) => Promise<{ results: never[] }>>(async () => ({ results: [] })));
vi.mock('@/lib/tmdb/client', () => ({ discoverMovies, discoverTV }));

import { useRowGenreCanon, canonLatestDate } from './useRowGenreCanon';

const rowSpec = { id: { kind: 'genre-canon', genreId: 18 }, label: 'Klassiker' } as unknown as RowSpec;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useRowGenreCanon — the Klassiker row', () => {
  it('asks only for titles at least ten years old when no decade is chosen', async () => {
    renderHook(() => useRowGenreCanon(rowSpec, new Set(), DEFAULT_FILTERS), { wrapper });
    await waitFor(() => expect(discoverTV).toHaveBeenCalled());
    const cutoff = canonLatestDate(new Date());
    expect(cutoff).toBe(`${new Date().getFullYear() - 10}-12-31`);
    expect(discoverTV.mock.calls[0][0]).toMatchObject({ 'first_air_date.lte': cutoff });
    expect(discoverMovies.mock.calls[0][0]).toMatchObject({ 'primary_release_date.lte': cutoff });
  });

  it('a chosen decade still sets its own bounds', async () => {
    discoverTV.mockClear();
    renderHook(() => useRowGenreCanon(rowSpec, new Set(), { ...DEFAULT_FILTERS, decade: '1990' }), { wrapper });
    await waitFor(() => expect(discoverTV).toHaveBeenCalled());
    expect(discoverTV.mock.calls[0][0]).toMatchObject({ 'first_air_date.gte': '1990-01-01', 'first_air_date.lte': '1999-12-31' });
  });
});
