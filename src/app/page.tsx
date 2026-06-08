'use client';

import { useMemo } from 'react';
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
import JustWatchCredit from '@/components/ui/JustWatchCredit';
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
        text: 'Ja. Streamingrådgivaren på Binge.nu analyserar vilka av dina abonnemang som faktiskt används av titlarna i ditt bibliotek. Den visar vilka tjänster du kan pausa utan att missa något — och hur mycket du sparar per månad.',
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
        text: 'När du lägger till en TV-serie i din lista på Binge.nu visas kommande avsnitt automatiskt i din kalender, med datum och avsnittsinformation i svensk tidszon. Kalendern visar även avsnitt för serier du vill se och digitala filmsläpp för filmer du vill se i Sverige.',
      },
    },
  ],
};

// LandingPage renderas i två lägen: (a) fullt — med trending-sektion — för
// faktiskt anonyma användare som vi vet är inloggade ut; (b) lättviktigt
// utan trending-fetch när vi pre-renderar bredvid skelettet under auth-
// loading. Detta sparar en TMDB-request mot återvändande inloggade
// användare som aldrig kommer att se trending-sektionen.
function LandingPage({ withTrending = true }: { withTrending?: boolean }) {
  const { signIn } = useAuth();
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
                placeholder="Sök film eller serie…"
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
              <div className="text-xs font-bold text-accent mb-[3px]">Streamingrådgivaren</div>
              <div className="text-xxs text-white/50 leading-snug max-w-[140px]">Pausa tjänster du inte använder.</div>
            </div>
          </div>
        </div>
      </section>

      {withTrending && <LandingPageTrending />}
    </div>
  );
}

// Sub-komponent som äger trending-fetchen så att hooken bara fyrar när
// LandingPage faktiskt renderas mot en användare som är anonym (auth
// resolverad). Pre-rendering bredvid skelettet skickar withTrending={false}
// så vi slipper bortkastad TMDB-request mot returnerande inloggade.
function LandingPageTrending() {
  const { data: trending } = useTrending('all', 'week');
  const items = (trending?.results ?? [])
    .filter(r => isAddableMediaType(r) && !hasNonLatinTitle(r.title ?? r.name, r.original_title ?? r.original_name))
    .slice(0, 10);

  if (items.length === 0) return null;

  return (
    <section className="max-w-[1000px] mx-auto px-4 py-8">
      <div className="bg-surface border border-border-main rounded-sm">
        <div className="px-3 py-[6px] border-b border-border-light">
          <h2 className="text-sm font-bold text-text-secondary m-0">Trendande just nu</h2>
        </div>
        <TitleGrid items={items} />
      </div>
    </section>
  );
}

function EmptyLibrary() {
  return (
    <div className="hem-empty">
      <h2>Bygg ditt bibliotek.</h2>
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

function DashboardSkeleton() {
  // Visas för inloggade återvändande användare medan Firebase Auth resolveras.
  // Aldrig prerendrad — `wasLoggedIn` är alltid `false` på servern (ingen
  // localStorage). Crawlers ser därför LandingPage istället.
  //
  // Renderar HemHero i loading-läge så användaren ser samma "Hämtar din
  // vecka…"-copy direkt — visuell kontinuitet hela vägen från auth-loading
  // genom watchlist-loading till calendar-loading till focal block. Annars
  // skulle vi blinka ett tomt fält först.
  return (
    <>
      <HemHero focal={null} totalThisWeek={0} hasLibrary={true} isLoading={true} />
      <div className="hem-grid">
        <div>
          <div className="hem-focal-skeleton" aria-hidden="true" />
        </div>
        <aside className="rail" aria-label="Sidostatistik" aria-hidden="true" />
      </div>
    </>
  );
}

function Dashboard() {
  const { items, loading: watchlistLoading } = useWatchlist();
  const { entries: calendarEntries, isLoading: calendarLoading } = useCalendarEntries();

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

  const hasLibrary = items.length > 0;
  // EmptyLibrary får bara renderas när vi *vet* att biblioteket är tomt —
  // alltså efter att Firestore-snapshoten kommit (watchlistLoading=false)
  // och items är tomt. Annars skulle vi blinka "Välkommen, lägg till
  // titlar" mot en användare som faktiskt har 100 serier på laddning.
  const showEmptyLibrary = !watchlistLoading && !hasLibrary;
  // Loading-state till hero: täcker hela vattenfallet (watchlist → calendar).
  // Hero visar "Hämtar din vecka…" så fort något av stegen är pågående.
  const isLoading = watchlistLoading || calendarLoading;
  const focalKey = focal ? focalEntryKey(focal) : undefined;

  return (
    <>
      <HemHero
        focal={focal}
        totalThisWeek={totalThisWeek}
        hasLibrary={hasLibrary || watchlistLoading}
        isLoading={isLoading}
      />

      {showEmptyLibrary ? (
        <EmptyLibrary />
      ) : (
        <div className="hem-grid">
          <div>
            {isLoading ? (
              // Reservera utrymme för BÅDA focal + filmstrip så hela
              // main-column-höjden är stabil under loading. Annars växer
              // sektion plötsligt med ~370px när entries resolveras
              // (focal-skeleton 530 → focal + 44px gap + filmstrip 330).
              <>
                <div className="hem-focal-skeleton" aria-hidden="true" />
                <div className="hem-filmstrip-skeleton" aria-hidden="true" />
              </>
            ) : (
              <>
                {focal && <HemFocal entry={focal} />}
                <LaterThisWeek entries={calendarEntries} excludeKey={focalKey} />
              </>
            )}
          </div>
          <aside className="rail" aria-label="Sidostatistik">
            <SparandeTile />
            <VannerTile />
            <GrupperTile />
          </aside>
        </div>
      )}

      {hasLibrary && !isLoading && (
        <div style={{ marginTop: 16 }}>
          <JustWatchCredit />
        </div>
      )}
    </>
  );
}

export default function DashboardPage() {
  const { user, loading } = useAuth();

  // FAQ JSON-LD är alltid med på `/` — viktigast i prerendrad HTML.
  const faqLd = (
    <script
      type="application/ld+json"
      // Hardcoded konstant — ingen XSS-risk.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
    />
  );

  // Pre-hydration / auth-loading: rendera BÅDA staterna sida-vid-sida.
  // CSS i globals.css döljer den ena baserat på .returning-user-klassen som
  // ett inline-script i <head> sätter innan body parsas. Resultat:
  // - Crawlers + anonyma användare ser LandingPage i HTML:en (SEO-vänligt)
  // - Återvändande inloggade ser skelettet direkt utan LandingPage-flash
  //
  // withTrending={false} på LandingPage så vi inte fyrar TMDB-requesten mot
  // användare som ändå inte kommer att se trending-sektionen.
  if (loading) {
    return (
      <>
        {faqLd}
        <div data-pre-state="landing">
          <LandingPage withTrending={false} />
        </div>
        <div data-pre-state="returning-skeleton" aria-hidden="true">
          <DashboardSkeleton />
        </div>
      </>
    );
  }

  // Auth resolverat utan user: anonym besökare. Visa LandingPage med
  // trending-sektionen.
  if (!user) {
    return (
      <>
        {faqLd}
        <LandingPage />
      </>
    );
  }

  // Auth resolverat med user: dashboard.
  return (
    <>
      {faqLd}
      <Dashboard />
    </>
  );
}
