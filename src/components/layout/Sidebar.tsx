'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Search, LayoutDashboard, Compass, Calendar, BarChart3,
  CreditCard, Star, Rss, Library, Tv, Film, BookmarkCheck, List, Users, UsersRound, UserCircle2, CircleSlash,
} from 'lucide-react';
import { useMemo, useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useFriendRequests } from '@/hooks/useFriends';
import { useSearchBox } from '@/hooks/useSearchBox';
import { SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';
import ProviderDot from '@/components/ui/ProviderDot';
import { isEndedStatus } from '@/lib/airingState';
import type { WatchStatus } from '@/types';
import SearchDropdown from '@/components/search/SearchDropdown';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Utforska', href: '/discover', icon: Compass },
  { label: 'Kalender', href: '/calendar', icon: Calendar },
  { label: 'Statistik', href: '/stats', icon: BarChart3 },
  { label: 'Streamingrådgivare', href: '/savings', icon: CreditCard },
  { label: 'Rekommendationer', href: '/recommendations', icon: Star },
  { label: 'Tillsammans', href: '/tillsammans/ny', icon: Users },
  { label: 'Grupper', href: '/grupper', icon: UsersRound },
  { label: 'Vänner', href: '/my/friends', icon: UserCircle2 },
  { label: 'Flöde', href: '/feed', icon: Rss },
];

// 'mina' (TV) ersätter både gamla 'följer' och 'sedd' för serier — sub-state
// (aktiv/ikapp/avslutad) deriveras från progress + TMDB. Film fortsätter
// använda 'sedd' som terminal. Gamla rutter /my/following och /my/watched
// finns kvar som redirects (firebase.json) för bakåtkompabilitet.
type CollectionItem = { label: string; href: string; status: WatchStatus | null; icon: typeof Library; mediaType?: 'tv' | 'movie' };
const COLLECTION_ITEMS: CollectionItem[] = [
  { label: 'Alla', href: '/my/all', status: null, icon: Library },
  { label: 'Mina serier', href: '/my/series', status: 'mina', mediaType: 'tv', icon: Tv },
  { label: 'Mina filmer', href: '/my/films', status: 'sedd', mediaType: 'movie', icon: Film },
  { label: 'Vill se', href: '/my/want-to-watch', status: 'vill_se', icon: BookmarkCheck },
  { label: 'Avbrutna', href: '/my/avbrutna', status: 'avbruten', icon: CircleSlash },
  { label: 'Listor', href: '/my/lists', status: null, icon: List },
];

export default function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { items } = useWatchlist();
  const { data: friendRequests } = useFriendRequests();
  const pendingRequestCount = friendRequests?.length ?? 0;
  const { searchQuery, setSearchQuery, debouncedQuery, searchFocused, setSearchFocused, searchRef, clearSearch } = useSearchBox();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const myProviderIds = user?.myProviders ?? [];
  const subscribedProviders = SWEDISH_PROVIDERS.filter(
    p => p.type === 'flatrate' && myProviderIds.includes(p.id)
  );

  // statusCounts är typ-aware för "Mina serier" (TV i 'mina') och
  // "Mina filmer" (film i 'sedd') — annars skulle counten räkna över alla
  // mediatyper och bli vilseledande. minaSeriesActive = TV i 'mina' som
  // INTE är avslutad (sub-state aktiv eller ikapp) — driver "12/45"-display.
  const { tvCount, movieSeddCount, willSeeCount, avbrutenCount, minaSeriesActive, providerCounts } = useMemo(() => {
    let tv = 0, mov = 0, ws = 0, av = 0, active = 0;
    const pc: Record<number, number> = {};
    for (const i of items) {
      if (i.dropped) continue;
      if (i.status === 'mina' && i.mediaType === 'tv') {
        tv++;
        if (!isEndedStatus(i.tmdbStatus)) active++;
      } else if (i.status === 'sedd' && i.mediaType === 'movie') {
        mov++;
      } else if (i.status === 'vill_se') {
        ws++;
      } else if (i.status === 'avbruten') {
        av++;
      }
      for (const pid of i.providers ?? []) pc[pid] = (pc[pid] ?? 0) + 1;
    }
    return {
      tvCount: tv,
      movieSeddCount: mov,
      willSeeCount: ws,
      avbrutenCount: av,
      minaSeriesActive: active,
      providerCounts: pc,
    };
  }, [items]);

  function countFor(item: CollectionItem): number {
    if (item.href === '/my/series') return tvCount;
    if (item.href === '/my/films') return movieSeddCount;
    if (item.href === '/my/want-to-watch') return willSeeCount;
    if (item.href === '/my/avbrutna') return avbrutenCount;
    return 0;
  }

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href));

  return (
    <aside className="w-sidebar bg-sidebar-bg text-text-sidebar flex flex-col text-base shrink-0 h-screen overflow-y-auto">
      <div className="px-4 py-3 border-b border-white/5">
        <Link href="/" className="text-[17px] font-extrabold text-accent no-underline">
          binge <span className="font-normal text-text-secondary text-sm">.nu</span>
        </Link>
      </div>

      <div className="relative mx-[10px] my-[6px]" ref={searchRef}>
        <div className="flex items-center gap-[5px] px-[9px] py-1 bg-white/[0.04] border border-white/[0.06] rounded-sm">
          <Search size={12} className="text-text-sidebar shrink-0" />
          <input
            type="text"
            placeholder="Sök..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            className="bg-transparent border-none text-[#bbb] text-sm font-[inherit] outline-none w-full placeholder:text-[#4a4a55]"
          />
        </div>
        {searchFocused && debouncedQuery.length >= 2 && (
          <SearchDropdown
            query={debouncedQuery}
            onSelect={() => {
              clearSearch();
              onClose?.();
            }}
          />
        )}
      </div>

      <div className="px-4 pt-3 pb-[3px] text-xxs uppercase tracking-[1.5px] text-sidebar-label font-semibold">
        Översikt
      </div>
      {NAV_ITEMS.map(item => {
        const active = isActive(item.href);
        const Icon = item.icon;
        // Pending friend requests-badge på Vänner-raden — bara klient-sidigt
        // (mounted-guard) eftersom static export annars hydrerar med fel siffra.
        const showBadge = mounted && item.href === '/my/friends' && pendingRequestCount > 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            className={`flex items-center gap-[8px] px-4 py-[5px] cursor-pointer border-l-[3px] no-underline hover:bg-white/[0.05] hover:text-[#ccc] ${
              active
                ? 'bg-accent/[0.12] text-white border-l-accent font-semibold'
                : 'text-text-sidebar border-l-transparent'
            }`}
          >
            <Icon size={14} className={active ? 'text-accent' : 'text-text-sidebar opacity-50'} />
            <span className="flex-1">{item.label}</span>
            {showBadge && (
              <span className="bg-accent text-white text-xxs font-semibold rounded-sm px-[5px] py-[1px] leading-none">
                {pendingRequestCount}
              </span>
            )}
          </Link>
        );
      })}

      <div className="px-4 pt-3 pb-[3px] text-xxs uppercase tracking-[1.5px] text-sidebar-label font-semibold">
        Samling
      </div>
      {COLLECTION_ITEMS.map(item => {
        const active = isActive(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            className={`flex items-center gap-[8px] px-4 py-[5px] cursor-pointer border-l-[3px] no-underline hover:bg-white/[0.05] hover:text-[#ccc] ${
              active
                ? 'bg-accent/[0.12] text-white border-l-accent font-semibold'
                : 'text-text-sidebar border-l-transparent'
            }`}
          >
            <Icon size={14} className={active ? 'text-accent' : 'text-text-sidebar opacity-50'} />
            <span className="flex-1">{item.label}</span>
            {mounted && item.status && countFor(item) > 0 && (
              <span className="text-xs text-accent">
                {item.href === '/my/series' && minaSeriesActive !== tvCount
                  ? `${minaSeriesActive}/${tvCount}`
                  : countFor(item)}
              </span>
            )}
          </Link>
        );
      })}

      {mounted && (
        <div className="mt-auto pt-1 border-t border-white/[0.04]">
          <div className="px-4 pt-3 pb-[3px] text-xxs uppercase tracking-[1.5px] text-sidebar-label font-semibold">
            Tjänster
          </div>
          {subscribedProviders.length > 0 ? subscribedProviders.map(provider => {
            const count = providerCounts[provider.id] ?? 0;
            return (
              <Link
                key={provider.id}
                href={`/provider/${provider.id}/`}
                onClick={onClose}
                className="flex items-center justify-between px-4 py-[2px] text-sm no-underline text-text-sidebar hover:text-[#ccc] hover:bg-white/[0.03]"
              >
                <span className="flex items-center gap-[5px]">
                  <ProviderDot color={provider.color} size={5} />
                  {provider.name}
                </span>
                {count > 0 && (
                  <span className="text-xs text-text-sidebar">{count} {count === 1 ? 'titel' : 'titlar'}</span>
                )}
              </Link>
            );
          }) : (
            <Link href="/settings" onClick={onClose} className="block px-4 py-[2px] text-sm no-underline text-text-sidebar hover:text-[#ccc]">
              Lägg till tjänster →
            </Link>
          )}
        </div>
      )}

      <div className="px-4 py-2 border-t border-white/[0.04] text-xs text-sidebar-label mt-auto">
        <Link href="/settings" onClick={onClose} className="text-accent no-underline">
          Inställningar
        </Link>
        <div className="mt-2 text-[8px] text-[#3e3e48] leading-tight">
          Drivs av TMDB. Ej godkänd eller certifierad av TMDB.
        </div>
      </div>
    </aside>
  );
}
