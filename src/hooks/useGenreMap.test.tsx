import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/tmdb/client', () => ({
  getMovieGenres: vi.fn(async () => ({ genres: [{ id: 35, name: 'Komedi' }] })),
  getTVGenres: vi.fn(async () => ({ genres: [{ id: 10762, name: 'Kids' }, { id: 99999, name: 'Okänd' }] })),
}));

import { useGenreMap } from './useGenreMap';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useGenreMap', () => {
  it('visar appens svenska namn i stället för TMDB:s engelska', async () => {
    const { result } = renderHook(() => useGenreMap(), { wrapper });
    await waitFor(() => expect(result.current.get(10762)).toBe('Barn'));
    expect(result.current.get(35)).toBe('Komedi');
  });

  it('behåller TMDB:s namn för en genre appen inte känner till', async () => {
    const { result } = renderHook(() => useGenreMap(), { wrapper });
    await waitFor(() => expect(result.current.get(99999)).toBe('Okänd'));
  });
});
