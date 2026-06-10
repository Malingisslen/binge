'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useClickOutside } from './useClickOutside';

export function useSearchBox() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // SÖ1: global Cmd/Ctrl+K fokuserar söket. Policy: alltid fokus-stjäl,
  // även från andra inputs/textareas — modifierare-ackordet är en avsiktlig
  // gest (samma beteende som Slack/GitHub/Linear-paletter), och utan
  // fokus-stjälning vore genvägen död exakt när man behöver den (mitt i
  // ett formulär). preventDefault stoppar webbläsarens egna Ctrl+K
  // (Firefox sökfält, Chrome adressfältssök).
  useEffect(() => {
    function handleShortcut(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const input = inputRef.current;
        if (input) {
          input.focus();
          input.select();
          setSearchFocused(true);
        }
      }
    }
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  const close = useCallback(() => setSearchFocused(false), []);
  useClickOutside(searchRef, close);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchFocused(false);
  }, []);

  return { searchQuery, setSearchQuery, debouncedQuery, searchFocused, setSearchFocused, searchRef, inputRef, clearSearch };
}
