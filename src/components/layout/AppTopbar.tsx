'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import WeekStrip from './WeekStrip';
import TopbarActions from './TopbarActions';
import { useSearchBox } from '@/hooks/useSearchBox';
import SearchDropdown from '@/components/search/SearchDropdown';

// The new Direction-H topbar. Grid: 200px brand · 1fr week strip · 240px
// search+avatar. On narrow screens the grid collapses to a single column
// (see globals.css). The week strip itself remains 7 day-cells on all sizes,
// just compressed.

export default function AppTopbar() {
  const {
    searchQuery, setSearchQuery, debouncedQuery,
    searchFocused, setSearchFocused, searchRef, clearSearch,
  } = useSearchBox();

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
              type="text"
              placeholder="Sök titel, person eller vän…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              aria-label="Sök"
            />
            <span className="k" aria-hidden="true">⌘K</span>
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
