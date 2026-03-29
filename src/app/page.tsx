'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import WeeklyCalendar from '@/components/calendar/WeeklyCalendar';
import WatchingTable from '@/components/dashboard/WatchingTable';
import SearchDropdown from '@/components/search/SearchDropdown';
import { useSearchBox } from '@/hooks/useSearchBox';
import TitleGrid from '@/components/title/TitleGrid';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useCalendarEntries } from '@/hooks/useCalendar';
import { useAuth } from '@/hooks/useAuth';
import { useTrending } from '@/hooks/useTMDB';

function LandingPage() {
  const { signIn } = useAuth();
  const { data: trending } = useTrending('all', 'week');
  const items = (trending?.results ?? []).filter(r => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 10);
  const { searchQuery, setSearchQuery, debouncedQuery, searchFocused, setSearchFocused, searchRef, clearSearch } = useSearchBox();

  return (
    <div>
      <div className="text-center py-8">
        <h1 className="text-[24px] font-extrabold text-accent mb-1">
          binge<span className="font-normal text-text-muted text-[18px]">.nu</span>
        </h1>
        <p className="text-sm text-text-secondary mb-2 max-w-[400px] mx-auto">
          Sök efter en film eller serie — se var den finns att streama i Sverige.
        </p>
        <div className="relative max-w-[400px] mx-auto mb-4" ref={searchRef}>
          <div className="flex items-center gap-[5px] px-3 py-[6px] bg-surface border border-border-main rounded-sm">
            <Search size={14} className="text-text-muted shrink-0" />
            <input
              type="text"
              placeholder="Sök film eller serie..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              className="bg-transparent border-none text-text-primary text-sm font-[inherit] outline-none w-full placeholder:text-text-muted"
            />
          </div>
          {searchFocused && debouncedQuery.length >= 2 && (
            <SearchDropdown
              query={debouncedQuery}
              onSelect={clearSearch}
            />
          )}
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={signIn}
            className="px-4 py-[5px] bg-accent text-white border-none rounded-sm cursor-pointer font-[inherit] text-xs font-semibold"
          >
            Logga in med Google
          </button>
          <Link href="/login/" className="text-xs text-accent no-underline">
            Skapa konto
          </Link>
        </div>
      </div>

      {items.length > 0 && (
        <div className="bg-surface border border-border-main rounded-sm">
          <div className="px-3 py-[6px] border-b border-border-light">
            <span className="text-sm font-bold text-text-secondary">Trendande just nu</span>
          </div>
          <TitleGrid items={items} />
        </div>
      )}
    </div>
  );
}

function OnboardingCTA() {
  return (
    <div className="bg-surface border border-accent/30 rounded-sm mb-[14px] px-4 py-4 text-center">
      <h2 className="text-sm font-bold text-text-primary mb-1">Välkommen till Binge!</h2>
      <p className="text-xs text-text-muted mb-3">
        Börja genom att lägga till serier och filmer du tittar på.
      </p>
      <div className="flex justify-center gap-2">
        <Link
          href="/series/"
          className="px-3 py-[5px] bg-accent text-white border-none rounded-sm text-xs font-semibold no-underline"
        >
          Utforska serier
        </Link>
        <Link
          href="/films/"
          className="px-3 py-[5px] bg-surface text-text-secondary border border-border-main rounded-sm text-xs font-semibold no-underline"
        >
          Utforska filmer
        </Link>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const { items, getByStatus } = useWatchlist();
  const following = getByStatus('följer');
  const calendarEntries = useCalendarEntries();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="text-sm text-text-muted">Laddar...</div>
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  const isEmpty = items.length === 0;

  return (
    <>
      {isEmpty && <OnboardingCTA />}
      <WeeklyCalendar entries={calendarEntries} />
      <WatchingTable items={following} />
    </>
  );
}
