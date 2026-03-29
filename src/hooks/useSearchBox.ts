'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useClickOutside } from './useClickOutside';

export function useSearchBox() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const close = useCallback(() => setSearchFocused(false), []);
  useClickOutside(searchRef, close);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchFocused(false);
  }, []);

  return { searchQuery, setSearchQuery, debouncedQuery, searchFocused, setSearchFocused, searchRef, clearSearch };
}
