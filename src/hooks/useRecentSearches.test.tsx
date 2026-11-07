import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useClearRecentSearchesOnSignOut } from './useRecentSearches';
import { addRecentSearch, readRecentSearches } from '@/lib/recentSearches';

beforeEach(() => {
  window.localStorage.clear();
});

describe('useClearRecentSearchesOnSignOut', () => {
  it('clears the history when a signed-in user signs out', () => {
    addRecentSearch('severance');
    const { rerender } = renderHook(({ uid }) => useClearRecentSearchesOnSignOut(uid), {
      initialProps: { uid: 'u1' as string | null },
    });
    expect(readRecentSearches()).toEqual(['severance']);
    rerender({ uid: null });
    expect(readRecentSearches()).toEqual([]);
  });

  it('keeps a guest’s own history', () => {
    addRecentSearch('dune');
    const { rerender } = renderHook(({ uid }) => useClearRecentSearchesOnSignOut(uid), {
      initialProps: { uid: null as string | null },
    });
    rerender({ uid: null });
    expect(readRecentSearches()).toEqual(['dune']);
  });

  it('does not clear while the same user stays signed in', () => {
    addRecentSearch('dune');
    const { rerender } = renderHook(({ uid }) => useClearRecentSearchesOnSignOut(uid), {
      initialProps: { uid: 'u1' as string | null },
    });
    rerender({ uid: 'u1' });
    expect(readRecentSearches()).toEqual(['dune']);
  });
});
