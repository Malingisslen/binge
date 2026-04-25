'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, Sparkles } from 'lucide-react';
import UpcomingCards from '@/components/dashboard/UpcomingCards';
import WatchingTable from '@/components/dashboard/WatchingTable';
import SubscriptionAdvisorWidget from '@/components/dashboard/SubscriptionAdvisorWidget';
import RevivalNudge from '@/components/dashboard/RevivalNudge';
import SearchDropdown from '@/components/search/SearchDropdown';
import { useSearchBox } from '@/hooks/useSearchBox';
import TitleGrid from '@/components/title/TitleGrid';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useCalendarEntries } from '@/hooks/useCalendar';
import { useAuth } from '@/hooks/useAuth';
import { useTrending } from '@/hooks/useTMDB';
import { hasNonLatinTitle } from '@/lib/utils/titleFilter';
import { isAddableMediaType } from '@/lib/tmdb/client';

function LandingPage() {
  const { signIn } = useAuth();
  const { data: trending } = useTrending('all', 'week');
  const items = (trending?.results ?? [])
    .filter(r => isAddableMediaType(r) && !hasNonLatinTitle(r.title ?? r.name, r.original_title ?? r.original_name))
    .slice(0, 10);
  const { searchQuery, setSearchQuery, debouncedQuery, searchFocused, setSearchFocused, searchRef, clearSearch } = useSearchBox();

  return (
    <div className="min-h-screen bg-page">
      <section className="bg-sidebar-bg text-white">
        <div className="max-w-[640px] mx-auto px-4 py-16 text-center">
          <h1 className="text-[32px] font-extrabold text-accent mb-2">
            binge<span className="font-normal text-white/60 text-[22px]">.nu</span>
          </h1>
          <p className="text-[17px] font-semibold mb-2 max-w-[520px] mx-auto">
            Håll koll på vad du tittar på — och var det streamas.
          </p>
          <p className="text-sm text-white/60 mb-5 max-w-[480px] mx-auto leading-relaxed">
            Se vilken streamingtjänst som har filmen eller serien du söker, håll reda på kommande avsnitt och samla allt på ett ställe.
          </p>
          <div className="relative max-w-[440px] mx-auto mb-4" ref={searchRef}>
            <div className="flex items-center gap-[5px] px-3 py-[8px] bg-white/[0.08] border border-white/10 rounded-sm">
              <Search size={14} className="text-white/50 shrink-0" />
              <input
                type="text"
                placeholder="Sök film eller serie..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                className="bg-transparent border-none text-white text-sm font-[inherit] outline-none w-full placeholder:text-white/40"
              />
            </div>
            {searchFocused && debouncedQuery.length >= 2 && (
              <SearchDropdown
                query={debouncedQuery}
                onSelect={clearSearch}
              />
            )}
          </div>
          <button
            onClick={signIn}
            className="px-5 py-[7px] bg-accent text-white border-none rounded-sm cursor-pointer font-[inherit] text-sm font-semibold mb-8"
          >
            Logga in med Google
          </button>
          <div className="flex justify-center gap-8 flex-wrap max-w-[520px] mx-auto">
            <div className="text-center">
              <div className="text-xs font-bold text-accent mb-[3px]">Streaming-koll</div>
              <div className="text-xxs text-white/50 leading-snug max-w-[140px]">Se direkt vilken tjänst som har titeln.</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-bold text-accent mb-[3px]">Avsnittkalender</div>
              <div className="text-xxs text-white/50 leading-snug max-w-[140px]">Missa aldrig ett nytt avsnitt.</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-bold text-accent mb-[3px]">Sparrådgivare</div>
              <div className="text-xxs text-white/50 leading-snug max-w-[140px]">Pausa tjänster du inte använder.</div>
            </div>
          </div>
        </div>
      </section>

      {items.length > 0 && (
        <section className="max-w-[1000px] mx-auto px-4 py-8">
          <div className="bg-surface border border-border-main rounded-sm">
            <div className="px-3 py-[6px] border-b border-border-light">
              <span className="text-sm font-bold text-text-secondary">Trendande just nu</span>
            </div>
            <TitleGrid items={items} />
          </div>
        </section>
      )}
    </div>
  );
}

function CalibrationCTA() {
  return (
    <div className="bg-surface border border-accent/30 rounded-sm mb-[14px] px-3 py-2 flex items-center gap-3">
      <Sparkles size={16} className="text-accent shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-text-primary">Kalibrera din smak</div>
        <div className="text-xxs text-text-muted">
          Svep igenom 10 populära titlar så lär vi känna din stil — används för smak-match och rekommendationer.
        </div>
      </div>
      <Link
        href="/kalibrera/"
        className="shrink-0 px-3 py-[5px] bg-accent text-white border-none rounded-sm text-xs font-semibold no-underline"
      >
        Kalibrera
      </Link>
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || loading) {
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
  const hasAnyRating = items.some(i => i.rating != null);
  const needsCalibration = !isEmpty
    && !hasAnyRating
    && !user.calibrationGenres;

  return (
    <>
      {isEmpty && <OnboardingCTA />}
      {needsCalibration && <CalibrationCTA />}
      <UpcomingCards entries={calendarEntries} />
      <RevivalNudge />
      <SubscriptionAdvisorWidget />
      <WatchingTable items={following} />
    </>
  );
}
