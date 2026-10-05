'use client';

import { useCallback, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutGrid, Calendar, Search, BarChart3, Menu } from 'lucide-react';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useEscapeKey } from '@/hooks/useEscapeKey';

// Mobile bottom tab bar — on phones the ONLY navigation (the subnav is hidden
// ≤980px). Malin picked variant B on 2026-10-05: the money layer (Rådgivaren)
// keeps its own tab, Hem moves into Mer and stays reachable via the logo.
// Sök is the center tab in the thumb zone, and it opens the topbar's own
// search field instead of a separate page.

// The topbar's search input carries this id, and Sök focuses it directly.
export const TOPBAR_SEARCH_ID = 'topbar-search';

type NavItem = {
  label: string;
  href: string;
  matches?: readonly string[];
};

const BIBLIOTEK: NavItem = { label: 'Bibliotek', href: '/my/all/', matches: ['/my/all', '/my/series', '/my/films', '/my/vill-se', '/my/avbrutna'] };
const KALENDER: NavItem = { label: 'Kalender', href: '/calendar/' };
const RADGIVAREN: NavItem = { label: 'Rådgivaren', href: '/savings/' };

// Everything the desktop subnav reaches that has no tab of its own.
export const MORE_ITEMS: readonly NavItem[] = [
  { label: 'Hem', href: '/' },
  { label: 'Rekommendationer', href: '/recommendations/', matches: ['/kalibrera'] },
  { label: 'Fråga Binge', href: '/ask/' },
  { label: 'Vänner', href: '/my/friends/', matches: ['/feed', '/user/'] },
  { label: 'Grupper', href: '/grupper/', matches: ['/tillsammans/'] },
  { label: 'Inställningar', href: '/settings/' },
];

export default function MobileTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const panelId = useId();
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  // The panel remembers which page it was opened on, so navigating anywhere
  // closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn !== null && openOn === pathname;

  const close = useCallback(() => setOpenOn(null), []);
  const closeAndRefocus = useCallback(() => {
    setOpenOn(null);
    moreButtonRef.current?.focus();
  }, []);
  useClickOutside(moreRef, close);
  useEscapeKey(open, closeAndRefocus);

  // Focus must happen inside the tap itself, or iOS will not raise the keyboard.
  function openSearch() {
    setOpenOn(null);
    const input = document.getElementById(TOPBAR_SEARCH_ID);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
      return;
    }
    router.push('/search/');
  }

  const moreActive = MORE_ITEMS.some(item => isActive(pathname, item));

  return (
    <nav className="m-tabs" aria-label="Huvudmeny">
      <TabLink item={BIBLIOTEK} icon={LayoutGrid} active={isActive(pathname, BIBLIOTEK)} />
      <TabLink item={KALENDER} icon={Calendar} active={isActive(pathname, KALENDER)} />
      <button
        type="button"
        className="center"
        onClick={openSearch}
        aria-current={pathname?.startsWith('/search') ? 'page' : undefined}
      >
        <span className="icn"><Search size={22} strokeWidth={1.5} aria-hidden="true" /></span>
        Sök
      </button>
      <TabLink item={RADGIVAREN} icon={BarChart3} active={isActive(pathname, RADGIVAREN)} />
      <div ref={moreRef} className="m-more">
        <button
          ref={moreButtonRef}
          type="button"
          className={moreActive ? 'is-on' : undefined}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpenOn(open ? null : pathname)}
        >
          <span className="icn"><Menu size={22} strokeWidth={1.5} aria-hidden="true" /></span>
          Mer
        </button>
        <ul id={panelId} className="m-more-panel" hidden={!open}>
          {MORE_ITEMS.map(item => {
            const active = isActive(pathname, item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={active ? 'is-on' : undefined}
                  aria-current={active ? 'page' : undefined}
                  onClick={close}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

function TabLink({ item, icon: Icon, active }: { item: NavItem; icon: typeof LayoutGrid; active: boolean }) {
  return (
    <Link href={item.href} className={active ? 'is-on' : undefined} aria-current={active ? 'page' : undefined}>
      <span className="icn"><Icon size={22} strokeWidth={1.5} aria-hidden="true" /></span>
      {item.label}
    </Link>
  );
}

export function isActive(pathname: string | null, item: NavItem): boolean {
  if (!pathname) return false;
  if (item.href === '/') return pathname === '/' || pathname === '';
  if (pathname.startsWith(item.href)) return true;
  return (item.matches ?? []).some(prefix => pathname.startsWith(prefix));
}
