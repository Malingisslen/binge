'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import SearchDropdown from '@/components/search/SearchDropdown';
import { useSearchBox } from '@/hooks/useSearchBox';
import TitleGrid from '@/components/title/TitleGrid';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useCalendarEntries } from '@/hooks/useCalendar';
import { useAuth } from '@/hooks/useAuth';
import { useTrending } from '@/hooks/useTMDB';
import { hasNonLatinTitle } from '@/lib/utils/titleFilter';
import { isAddableMediaType } from '@/lib/tmdb/client';
import HemHero from '@/components/home/HemHero';
import HemFocal from '@/components/home/HemFocal';
import LaterThisWeek from '@/components/home/LaterThisWeek';
import SparandeTile from '@/components/home/SparandeTile';
import VannerTile from '@/components/home/VannerTile';
import GrupperTile from '@/components/home/GrupperTile';
import { pickFocalEntry, focalEntryKey } from '@/components/home/focalPick';

const FAQ_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'Vad är Binge.nu och hur fungerar det?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Binge.nu är en gratis svensk mediatracker för film och TV-serier. Du loggar in med Google, lägger till titlar du tittar på eller vill se, och sajten visar automatiskt var varje titel går att streama i Sverige — Netflix, Viaplay, HBO Max, Disney+, SVT Play, TV4 Play med flera.',
      },
    },
    {
      '@type': 'Question',
      name: 'Var kan jag streama en specifik film eller serie i Sverige?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'På Binge.nu kan du söka efter en film eller serie och direkt se vilka svenska streamingtjänster som har den tillgänglig just nu. Data uppdateras löpande via TMDB.',
      },
    },
    {
      '@type': 'Question',
      name: 'Är Binge.nu gratis?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Ja, Binge.nu är helt gratis att använda. Du skapar ett konto via Google-inloggning, utan kostnad.',
      },
    },
    {
      '@type': 'Question',
      name: 'Kan Binge.nu hjälpa mig spara pengar på streaming?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Ja. Streamingrådgivaren på Binge.nu analyserar vilka av dina abonnemang som faktiskt används av titlarna på din bevakningslista. Den visar vilka tjänster du kan pausa utan att missa något — och hur mycket du sparar per månad.',
      },
    },
    {
      '@type': 'Question',
      name: 'Vilka streamingtjänster täcker Binge.nu?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Binge.nu täcker svenska streamingtjänster inklusive Netflix, Viaplay, HBO Max, Disney+, SVT Play, TV4 Play, C More, SkyShowtime och fler. Tjänsten är begränsad till tillgänglighet i Sverige.',
      },
    },
    {
      '@type': 'Question',
      name: 'Hur håller jag koll på kommande avsnitt av mina serier?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'När du lägger till en TV-serie i din lista på Binge.nu visas kommande avsnitt automatiskt i din kalender, med datum och avsnittsinformation i svensk tidszon.',
      },
    },
  ],
};

function LandingPage() {
  const { signIn } = useAuth();
  const { data: trending } = useTrending('all', 'week');
  const items = (trending?.results ?? [])
    .filter(r => isAddableMediaType(r) && !hasNonLatinTitle(r.title ?? r.name, r.original_title ?? r.original_name))
    .slice(0, 10);
  const { searchQuery, setSearchQuery, debouncedQuery, searchFocused, setSearchFocused, searchRef, clearSearch } = useSearchBox();

  return (
    <div className="min-h-screen bg-page">
      {/* FAQ JSON-LD for LLM/AI search discoverability */}
      <script
        type="application/ld+json"
        // Content is a hardcoded constant — no XSS risk
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />
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

function EmptyLibrary() {
  return (
    <div className="hem-empty">
      <h2>Välkommen till Binge.</h2>
      <p>
        Lägg till några serier eller filmer du tittar på så börjar veckan ovan
        fyllas med dina avsnitt — och tjänster du inte använder dyker upp
        som möjliga pauser i högerkolumnen.
      </p>
      <div className="actions">
        <Link href="/series/" className="btn">Utforska serier</Link>
        <Link href="/films/" className="btn btn-ghost">Utforska filmer</Link>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const { items } = useWatchlist();
  const calendarEntries = useCalendarEntries();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Compute focal + week-summary once per render. Pure function, cheap.
  const { focal, totalThisWeek } = useMemo(() => {
    const focal = pickFocalEntry(calendarEntries);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAhead = new Date(today);
    weekAhead.setDate(today.getDate() + 7);
    const totalThisWeek = calendarEntries.filter(e => {
      const d = new Date(e.airDate + 'T00:00:00');
      return d >= today && d < weekAhead;
    }).length;
    return { focal, totalThisWeek };
  }, [calendarEntries]);

  if (!mounted || loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="text-sm text-ink-3">Laddar...</div>
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  const hasLibrary = items.length > 0;
  const focalKey = focal ? focalEntryKey(focal) : undefined;

  return (
    <>
      <HemHero focal={focal} totalThisWeek={totalThisWeek} hasLibrary={hasLibrary} />

      {!hasLibrary ? (
        <EmptyLibrary />
      ) : (
        <div className="hem-grid">
          <div>
            {focal && <HemFocal entry={focal} />}
            <LaterThisWeek entries={calendarEntries} excludeKey={focalKey} />
          </div>
          <aside className="rail" aria-label="Sidostatistik">
            <SparandeTile />
            <VannerTile />
            <GrupperTile />
          </aside>
        </div>
      )}
    </>
  );
}
