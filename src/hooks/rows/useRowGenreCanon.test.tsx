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
  it('asks only for titles at least ten years old when no end year is chosen', async () => {
    renderHook(() => useRowGenreCanon(rowSpec, new Set(), DEFAULT_FILTERS), { wrapper });
    await waitFor(() => expect(discoverTV).toHaveBeenCalled());
    const cutoff = canonLatestDate(new Date());
    expect(cutoff).toBe(`${new Date().getFullYear() - 10}-12-31`);
    expect(discoverTV.mock.calls[0][0]).toMatchObject({ 'first_air_date.lte': cutoff });
    expect(discoverMovies.mock.calls[0][0]).toMatchObject({ 'primary_release_date.lte': cutoff });
  });

  it('a chosen year range still sets its own bounds', async () => {
    discoverTV.mockClear();
    renderHook(() => useRowGenreCanon(rowSpec, new Set(), { ...DEFAULT_FILTERS, yearMin: 1990, yearMax: 1999 }), { wrapper });
    await waitFor(() => expect(discoverTV).toHaveBeenCalled());
    expect(discoverTV.mock.calls[0][0]).toMatchObject({ 'first_air_date.gte': '1990-01-01', 'first_air_date.lte': '1999-12-31' });
  });

  it('the star floor and the year range reach both the film and the series query', async () => {
    discoverTV.mockClear();
    discoverMovies.mockClear();
    renderHook(() => useRowGenreCanon(rowSpec, new Set(), { ...DEFAULT_FILTERS, yearMin: 1990, yearMax: 1999, minStars: 4 }), { wrapper });
    await waitFor(() => expect(discoverMovies).toHaveBeenCalled());
    await waitFor(() => expect(discoverTV).toHaveBeenCalled());
    expect(discoverMovies.mock.calls[0][0]).toMatchObject({
      'primary_release_date.gte': '1990-01-01', 'primary_release_date.lte': '1999-12-31', 'vote_average.gte': '7.5',
    });
    expect(discoverTV.mock.calls[0][0]).toMatchObject({ 'vote_average.gte': '7.5' });
  });

  it('a changed filter is a new query, not the cached one', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    discoverMovies.mockClear();
    const { rerender } = renderHook(
      ({ f }) => useRowGenreCanon(rowSpec, new Set(), f),
      { wrapper: shared, initialProps: { f: { ...DEFAULT_FILTERS, minStars: 3 } } },
    );
    await waitFor(() => expect(discoverMovies).toHaveBeenCalled());
    const before = discoverMovies.mock.calls.length;
    rerender({ f: { ...DEFAULT_FILTERS, minStars: 4 } });
    await waitFor(() => expect(discoverMovies.mock.calls.length).toBeGreaterThan(before));
    expect(discoverMovies.mock.calls.at(-1)![0]).toMatchObject({ 'vote_average.gte': '7.5' });
  });

  it('a start year alone keeps the ten-year cutoff as the end', async () => {
    discoverTV.mockClear();
    renderHook(() => useRowGenreCanon(rowSpec, new Set(), { ...DEFAULT_FILTERS, yearMin: 1980 }), { wrapper });
    await waitFor(() => expect(discoverTV).toHaveBeenCalled());
    expect(discoverTV.mock.calls[0][0]).toMatchObject({ 'first_air_date.gte': '1980-01-01', 'first_air_date.lte': canonLatestDate(new Date()) });
  });
});
