import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act, waitFor } from '@testing-library/react';
import RecommendationsFilters, { useRecommendationFilters } from './RecommendationsFilters';
import { DEFAULT_FILTERS, type FilterState } from '@/types';

// The panel's Land, Lägsta betyg and Tillgänglighet controls write the state the rows read
// (applyClientFilters for Land and stars, wantedProviderIds for Mina tjänster; both tested
// on their own). These pin the wiring between them, which the logic tests cannot see.

function renderPanel(filters: FilterState = DEFAULT_FILTERS, hasMyProviders = true) {
  const onChange = vi.fn();
  render(<RecommendationsFilters filters={filters} onChange={onChange} onClearAll={vi.fn()} hasMyProviders={hasMyProviders} />);
  fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  return onChange;
}

const lastCall = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0] as FilterState;

describe('Rekommendationers filterpanel', () => {
  it('Filter opens the panel on one press and closes it on the next', () => {
    renderPanel();
    expect(screen.getByLabelText('Land')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
    expect(screen.queryByLabelText('Land')).not.toBeInTheDocument();
  });

  it('Land sets the country, and its chip removes it again', () => {
    const onChange = renderPanel();
    fireEvent.change(screen.getByLabelText('Land'), { target: { value: 'KR' } });
    expect(lastCall(onChange).country).toBe('KR');

    onChange.mockClear();
    render(<RecommendationsFilters filters={{ ...DEFAULT_FILTERS, country: 'KR' }} onChange={onChange} onClearAll={vi.fn()} hasMyProviders />);
    fireEvent.click(screen.getByRole('button', { name: /Ta bort filter: Sydkorea/ }));
    expect(lastCall(onChange).country).toBe('');
  });

  it('Lägsta betyg sets a half-star floor, and choosing it again clears it', () => {
    const onChange = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '3,5 stjärnor eller mer' }));
    expect(lastCall(onChange).minStars).toBe(3.5);

    onChange.mockClear();
    render(<RecommendationsFilters filters={{ ...DEFAULT_FILTERS, minStars: 3.5 }} onChange={onChange} onClearAll={vi.fn()} hasMyProviders />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Filter/ })[1]);
    fireEvent.click(screen.getAllByRole('button', { name: '3,5 stjärnor eller mer' })[1]);
    expect(lastCall(onChange).minStars).toBe(0);
  });

  it('Längd is a minute slider: pulling the top thumb sets an upper bound, the top stop leaves it open', () => {
    const onChange = renderPanel();
    fireEvent.change(screen.getByLabelText('Längst speltid'), { target: { value: '90' } });
    expect(lastCall(onChange)).toMatchObject({ runtimeMin: null, runtimeMax: 90 });
    fireEvent.change(screen.getByLabelText('Kortast speltid'), { target: { value: '45' } });
    expect(lastCall(onChange)).toMatchObject({ runtimeMin: 45, runtimeMax: null });
  });

  it('a runtime range shows as one chip that clears both ends', () => {
    const onChange = vi.fn();
    render(<RecommendationsFilters filters={{ ...DEFAULT_FILTERS, runtimeMin: 45, runtimeMax: 120 }} onChange={onChange} onClearAll={vi.fn()} hasMyProviders />);
    fireEvent.click(screen.getByRole('button', { name: 'Ta bort filter: 45–120 min' }));
    expect(lastCall(onChange)).toMatchObject({ runtimeMin: null, runtimeMax: null });
  });

  it('Mina tjänster switches availability to your services', () => {
    const onChange = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Mina tjänster' }));
    expect(lastCall(onChange).availability).toBe('mine');
  });

  it('without services of your own, Mina tjänster is not offered', () => {
    renderPanel(DEFAULT_FILTERS, false);
    expect(screen.queryByRole('button', { name: 'Mina tjänster' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Specifik tjänst' })).toBeInTheDocument();
  });
});

describe('useRecommendationFilters', () => {
  const profile = { hideNonLatinTitles: false, hiddenCountries: [] as string[], myProviders: [8] };
  beforeEach(() => localStorage.clear());

  it('Land, stars and Mina tjänster survive a reload', async () => {
    const first = renderHook(() => useRecommendationFilters(profile));
    await waitFor(() => expect(first.result.current.filters.country).toBe(''));
    act(() => first.result.current.setFilters({ ...first.result.current.filters, country: 'KR', minStars: 4, availability: 'mine' }));
    await waitFor(() => expect(localStorage.getItem('binge:filters:recommendations')).toContain('KR'));
    first.unmount();

    const again = renderHook(() => useRecommendationFilters(profile));
    await waitFor(() => expect(again.result.current.filters.country).toBe('KR'));
    expect(again.result.current.filters.minStars).toBe(4);
    expect(again.result.current.filters.availability).toBe('mine');
  });

  it('a saved Mina tjänster reads as Alla once you have no services', async () => {
    localStorage.setItem('binge:filters:recommendations', JSON.stringify({ availability: 'mine' }));
    const { result } = renderHook(() => useRecommendationFilters({ ...profile, myProviders: [] }));
    await waitFor(() => expect(result.current.filters.availability).toBe('all'));
  });
});
