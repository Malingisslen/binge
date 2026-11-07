import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchPage from './page';

const fetchNextPage = vi.fn();
const refetch = vi.fn();
let hookState: Record<string, unknown> = {};
let queryString = 'q=dune';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(queryString),
}));
vi.mock('@/hooks/useTMDB', () => ({
  useSearchPages: () => hookState,
}));
vi.mock('@/hooks/useSearchProviders', () => ({ useSearchProviders: () => ({}) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/components/title/TitleGrid', () => ({
  default: ({ items }: { items: unknown[] }) => <div data-testid="grid">{items.length}</div>,
}));
vi.mock('@/components/title/TitleRow', () => ({ default: () => <div /> }));
vi.mock('@/components/ui/JustWatchCredit', () => ({ default: () => null }));

const movie = (id: number) => ({ id, media_type: 'movie', title: `Film ${id}` });

function state(over: Record<string, unknown>) {
  return {
    data: { pages: [{ page: 1, total_pages: 2, total_results: 40, results: [movie(1), movie(2)] }] },
    isLoading: false,
    hasNextPage: true,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    isError: false,
    refetch,
    fetchNextPage,
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  fetchNextPage.mockReset();
  queryString = 'q=dune';
});

describe('SearchPage', () => {
  it('offers "Visa fler" while more pages exist and fetches the next page on click', () => {
    hookState = state({});
    render(<SearchPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Visa fler' }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('hides "Visa fler" on the last page', () => {
    hookState = state({ hasNextPage: false });
    render(<SearchPage />);
    expect(screen.queryByRole('button', { name: 'Visa fler' })).toBeNull();
  });

  it('disables the button while the next page loads', () => {
    hookState = state({ isFetchingNextPage: true });
    render(<SearchPage />);
    expect(screen.getByRole('button', { name: 'Hämtar…' })).toBeDisabled();
  });

  it('says so and offers a retry when the next page fails', () => {
    hookState = state({ isFetchNextPageError: true });
    render(<SearchPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Det gick inte att hämta fler träffar.');
    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('shows a retry, not "Inga träffar", when the first page fails', () => {
    hookState = state({ data: undefined, isError: true, hasNextPage: false });
    render(<SearchPage />);
    expect(screen.getByText('Sökningen gick inte att göra')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('remembers a search that found something', () => {
    hookState = state({});
    render(<SearchPage />);
    expect(JSON.parse(window.localStorage.getItem('binge:recentSearches') ?? '[]')).toEqual(['dune']);
  });

  it('does not remember a search without hits', () => {
    hookState = state({ data: { pages: [{ page: 1, total_pages: 1, total_results: 0, results: [] }] }, hasNextPage: false });
    render(<SearchPage />);
    expect(window.localStorage.getItem('binge:recentSearches')).toBeNull();
  });

  it('shows earlier searches when there is no query yet', () => {
    queryString = '';
    window.localStorage.setItem('binge:recentSearches', JSON.stringify(['severance']));
    hookState = state({ data: undefined, hasNextPage: false });
    render(<SearchPage />);
    expect(screen.getByRole('link', { name: 'severance' })).toHaveAttribute('href', expect.stringContaining('q=severance'));
  });
});
