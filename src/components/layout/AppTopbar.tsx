'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import WeekStrip from './WeekStrip';
import TopbarActions from './TopbarActions';
import { useSearchBox } from '@/hooks/useSearchBox';
import { detectMacLike, shortcutHint } from '@/lib/platform';
import SearchDropdown from '@/components/search/SearchDropdown';

// The new Direction-H topbar. Grid: 200px brand · 1fr week strip · 240px
// search+avatar. On narrow screens the grid collapses to a single column
// (see globals.css). The week strip itself remains 7 day-cells on all sizes,
// just compressed.

export default function AppTopbar() {
  const {
    searchQuery, setSearchQuery, debouncedQuery,
    searchFocused, setSearchFocused, searchRef, inputRef, clearSearch,
  } = useSearchBox();

  // H1: plattformsdetekterad genvägshint. Static export → server-HTML har
  // ingen navigator, så vi defaultar till false ('Ctrl K') och korrigerar
  // till '⌘K' efter mount. Första klientrendern matchar därmed server-HTML
  // (ingen hydration mismatch); Mac-användare ser hinten byta en frame
  // efter mount, vilket är osynligt i praktiken.
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(detectMacLike());
  }, []);

  // BIN-338: combobox a11y. The dropdown is open under exactly this condition
  // (same as the render gate below), so aria-expanded tracks reality. The id of
  // the keyboard-highlighted option lives in SearchDropdown (where activeIndex
  // is); it reports it up here so aria-activedescendant can sit on the input
  // while real focus stays in the input.
  const [activeDescId, setActiveDescId] = useState<string | null>(null);
  const dropdownOpen = searchFocused && debouncedQuery.length >= 2;

  return (
    <header className="app-topbar" role="banner">
      <Link href="/" className="brand" aria-label="binge.nu">
        <span className="mark-sq" aria-hidden="true" />
        binge.nu
      </Link>

      <WeekStrip />

      <div className="topbar-rhs">
        <div className="search-wrap" ref={searchRef}>
          <div className="search">
            <Search size={12} className="search-icon" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Sök titel, person eller vän…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onKeyDown={e => {
                if (e.key === 'Escape' && dropdownOpen) {
                  setSearchFocused(false);
                  inputRef.current?.blur();
                }
              }}
              aria-label="Sök"
              role="combobox"
              aria-expanded={dropdownOpen}
              aria-controls="search-listbox"
              aria-activedescendant={dropdownOpen && activeDescId ? activeDescId : undefined}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
            <span className="k" aria-hidden="true">{shortcutHint(isMac)}</span>
          </div>
          {dropdownOpen && (
            <div className="search-dropdown-wrap">
              <SearchDropdown
                query={debouncedQuery}
                onSelect={clearSearch}
                onActiveOptionChange={setActiveDescId}
              />
            </div>
          )}
        </div>
        <TopbarActions />
      </div>
    </header>
  );
}
