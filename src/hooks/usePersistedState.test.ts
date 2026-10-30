import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistedState } from './usePersistedState';
import { clearPersistedViewState, libraryFiltersKey } from '@/lib/persistedViewState';

type Filters = { tags: string[] };
const KEY = libraryFiltersKey('all');
const DEFAULT: Filters = { tags: [] };
const sanitize = (raw: unknown): Filters =>
  raw && typeof raw === 'object' && Array.isArray((raw as Filters).tags) ? (raw as Filters) : DEFAULT;
const stored = () => window.localStorage.getItem(KEY);

describe('usePersistedState after a session ends', () => {
  beforeEach(() => window.localStorage.clear());

  it('a mounted view resets and does not write the departing choice back', () => {
    const { result } = renderHook(() => usePersistedState(KEY, DEFAULT, sanitize));
    act(() => result.current[1]({ tags: ['förra personens tagg'] }));
    expect(stored()).toContain('förra personens tagg');

    act(() => clearPersistedViewState());

    expect(stored()).toBeNull();
    expect(result.current[0]).toEqual(DEFAULT);
    // An updater that builds on the previous value is where a stale in-memory copy would
    // be written back; it must build on the reset one.
    act(() => result.current[1](prev => ({ tags: [...prev.tags, 'ny'] })));
    expect(JSON.parse(stored()!)).toEqual({ tags: ['ny'] });
  });

  it('a view in another tab resets when the removal reaches it', () => {
    const { result } = renderHook(() => usePersistedState(KEY, DEFAULT, sanitize));
    act(() => result.current[1]({ tags: ['x'] }));

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: null }));
    });

    expect(result.current[0]).toEqual(DEFAULT);
  });

  it('another key changing elsewhere leaves this view alone', () => {
    const { result } = renderHook(() => usePersistedState(KEY, DEFAULT, sanitize));
    act(() => result.current[1]({ tags: ['x'] }));

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'binge:theme', newValue: null }));
    });

    expect(result.current[0]).toEqual({ tags: ['x'] });
  });


  it('an ordinary write to the same key in another tab leaves this view alone', () => {
    const { result } = renderHook(() => usePersistedState(KEY, DEFAULT, sanitize));
    act(() => result.current[1]({ tags: ['x'] }));

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: '{"tags":["y"]}' }));
    });

    expect(result.current[0]).toEqual({ tags: ['x'] });
  });
  it('a view in another tab resets when that tab clears all of storage', () => {
    const { result } = renderHook(() => usePersistedState(KEY, DEFAULT, sanitize));
    act(() => result.current[1]({ tags: ['x'] }));

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });

    expect(result.current[0]).toEqual(DEFAULT);
  });

  it('takes no key the sweep would miss', () => {
    // A type check, so tsc is what fails here, not vitest.
    // @ts-expect-error a plain string is not a PersistedViewKey
    renderHook(() => usePersistedState('binge:view:somewhere', DEFAULT, sanitize));
  });
});
