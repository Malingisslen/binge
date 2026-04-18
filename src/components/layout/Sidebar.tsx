'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Search, LayoutDashboard, Compass, Calendar, BarChart3,
  CreditCard, Star, Rss, Library, Eye, BookmarkCheck, Clock, List, Users, UsersRound,
} from 'lucide-react';
import { useMemo, useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
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
  { label: 'Flöde', href: '/feed', icon: Rss },
];

const COLLECTION_ITEMS = [
  { label: 'Alla', href: '/my/all', status: null, icon: Library },
  { label: 'Följer', href: '/my/following', status: 'följer' as const, icon: Eye },
  { label: 'Vill se', href: '/my/want-to-watch', status: 'vill_se' as const, icon: BookmarkCheck },
  { label: 'Sedd', href: '/my/watched', status: 'sedd' as const, icon: Clock },
  { label: 'Listor', href: '/my/lists', status: null, icon: List },
];

export default function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { items } = useWatchlist();
  const { searchQuery, setSearchQuery, debouncedQuery, searchFocused, setSearchFocused, searchRef, clearSearch } = useSearchBox();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const myProviderIds = user?.myProviders ?? [];
  const subscribedProviders = SWEDISH_PROVIDERS.filter(
    p => p.type === 'flatrate' && myProviderIds.includes(p.id)
  );

  const { statusCounts, followingOngoing, providerCounts } = useMemo(() => {
    const sc: Record<WatchStatus, number> = { 'följer': 0, 'vill_se': 0, 'sedd': 0 };
    const pc: Record<number, number> = {};
    let ongoing = 0;
    for (const i of items) {
      if (i.status in sc) sc[i.status]++;
      if (i.status === 'följer' && !i.dropped && !(i.mediaType === 'tv' && isEndedStatus(i.tmdbStatus))) {
        ongoing++;
      }
      for (const pid of i.providers ?? []) pc[pid] = (pc[pid] ?? 0) + 1;
    }
    return { statusCounts: sc, followingOngoing: ongoing, providerCounts: pc };
  }, [items]);

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
            {item.label}
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
            {mounted && item.status && statusCounts[item.status] > 0 && (
              <span className="text-xs text-accent">
                {item.status === 'följer' && followingOngoing !== statusCounts['följer']
                  ? `${followingOngoing}/${statusCounts['följer']}`
                  : statusCounts[item.status]}
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
