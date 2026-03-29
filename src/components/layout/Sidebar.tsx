'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';
import type { WatchStatus } from '@/types';
import SearchDropdown from '@/components/search/SearchDropdown';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/', section: 'Översikt' },
  { label: 'Utforska', href: '/discover', section: 'Översikt' },
  { label: 'Kalender', href: '/calendar', section: 'Översikt' },
];

const COLLECTION_ITEMS = [
  { label: 'Följer', href: '/my/following', status: 'följer' as const },
  { label: 'Sedd', href: '/my/watched', status: 'sedd' as const },
];

export default function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { items } = useWatchlist();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const myProviderIds = user?.myProviders ?? [];
  const subscribedProviders = SWEDISH_PROVIDERS.filter(
    p => p.type === 'flatrate' && myProviderIds.includes(p.id)
  );

  const { statusCounts, providerCounts } = useMemo(() => {
    const sc: Record<WatchStatus, number> = { 'följer': 0, 'sedd': 0 };
    const pc: Record<number, number> = {};
    for (const i of items) {
      if (i.status in sc) sc[i.status]++;
      for (const pid of i.providers ?? []) pc[pid] = (pc[pid] ?? 0) + 1;
    }
    return { statusCounts: sc, providerCounts: pc };
  }, [items]);

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
              setSearchQuery('');
              setSearchFocused(false);
              onClose?.();
            }}
          />
        )}
      </div>

      <div className="px-4 pt-3 pb-[3px] text-xxs uppercase tracking-[1.5px] text-sidebar-label font-semibold">
        Översikt
      </div>
      {NAV_ITEMS.map(item => (
        <Link
          key={item.href}
          href={item.href}
          onClick={onClose}
          className={`flex items-center justify-between px-4 py-[5px] cursor-pointer border-l-2 no-underline text-text-sidebar hover:bg-white/[0.02] hover:text-[#ccc] ${
            pathname === item.href
              ? 'bg-accent/[0.07] !text-text-sidebar-active border-l-accent font-semibold'
              : 'border-l-transparent'
          }`}
        >
          {item.label}
        </Link>
      ))}

      <div className="px-4 pt-3 pb-[3px] text-xxs uppercase tracking-[1.5px] text-sidebar-label font-semibold">
        Samling
      </div>
      {COLLECTION_ITEMS.map(item => (
        <Link
          key={item.href}
          href={item.href}
          onClick={onClose}
          className={`flex items-center justify-between px-4 py-[5px] cursor-pointer border-l-2 no-underline text-text-sidebar hover:bg-white/[0.02] hover:text-[#ccc] ${
            pathname === item.href
              ? 'bg-accent/[0.07] !text-text-sidebar-active border-l-accent font-semibold'
              : 'border-l-transparent'
          }`}
        >
          {item.label}
          {statusCounts[item.status] > 0 && (
            <span className="text-xs text-accent">{statusCounts[item.status]}</span>
          )}
        </Link>
      ))}

      {subscribedProviders.length > 0 && (
        <div className="mt-auto pt-1 border-t border-white/[0.04]">
          <div className="px-4 pt-3 pb-[3px] text-xxs uppercase tracking-[1.5px] text-sidebar-label font-semibold">
            Tjänster
          </div>
          {subscribedProviders.map(provider => {
            const count = providerCounts[provider.id] ?? 0;
            return (
              <Link
                key={provider.id}
                href={`/provider/${provider.id}/`}
                onClick={onClose}
                className="flex items-center justify-between px-4 py-[2px] text-sm no-underline text-text-sidebar hover:text-[#ccc]"
              >
                <span className="flex items-center">
                  <span
                    className="w-[5px] h-[5px] rounded-full mr-[5px] inline-block"
                    style={{ background: provider.color }}
                  />
                  {provider.name}
                </span>
                {count > 0 && (
                  <span className="text-xs text-text-sidebar">{count}</span>
                )}
              </Link>
            );
          })}
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
