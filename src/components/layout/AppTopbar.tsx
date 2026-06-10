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
              aria-label="Sök"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
            <span className="k" aria-hidden="true">{shortcutHint(isMac)}</span>
          </div>
          {searchFocused && debouncedQuery.length >= 2 && (
            <div className="search-dropdown-wrap">
              <SearchDropdown query={debouncedQuery} onSelect={clearSearch} />
            </div>
          )}
        </div>
        <TopbarActions />
      </div>
    </header>
  );
}
