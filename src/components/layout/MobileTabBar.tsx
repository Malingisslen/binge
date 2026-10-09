'use client';

import { useCallback, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutGrid, Calendar, Search, Menu, Home, Tag, Calculator, BookOpen } from 'lucide-react';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import ChromePart from './ChromePart';
import type { ChromeMode } from './chromeMode';

// Mobile bottom tab bar — on phones the ONLY navigation (the subnav is hidden
// ≤980px). Malin's choice on 2026-10-09: Hem has its own tab and Rådgivaren
// sits under Mer. Sök is the center tab in the thumb zone, and it opens the topbar's own
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
const HEM: NavItem = { label: 'Hem', href: '/' };

// Everything the desktop subnav reaches that has no tab of its own. Hem har egen
// flik (Malins val 2026-10-09): startsidan med dagens avsnitt är den man öppnar oftast.
export const MORE_ITEMS: readonly NavItem[] = [
  { label: 'Rådgivaren', href: '/savings/' },
  { label: 'Rekommendationer', href: '/recommendations/', matches: ['/kalibrera'] },
  { label: 'Fråga Binge', href: '/ask/' },
  { label: 'Vänner', href: '/my/friends/', matches: ['/feed', '/user/'] },
  { label: 'Inställningar', href: '/settings/' },
];

// The signed-out menu: only pages that work without an account. Grupper is out of
// every menu while the feature is paused (plan round 2, decision 4); its pages
// still answer for anyone holding a link.
const GUEST_HOME: NavItem = { label: 'Hem', href: '/' };
const GUEST_PRICES: NavItem = { label: 'Priser', href: '/streamingpriser/' };
const GUEST_CALCULATOR: NavItem = { label: 'Kalkylator', href: '/streamingkostnad/' };
const GUEST_GUIDES: NavItem = { label: 'Guider', href: '/guider/' };
export const GUEST_LINKS: readonly NavItem[] = [GUEST_HOME, GUEST_PRICES, GUEST_CALCULATOR, GUEST_GUIDES];

export default function MobileTabBar({ chrome = 'app' }: { chrome?: ChromeMode }) {
  return (
    <>
      <ChromePart mode={chrome} audience="app"><AppTabBar /></ChromePart>
      <ChromePart mode={chrome} audience="guest"><GuestTabBar /></ChromePart>
    </>
  );
}

function GuestTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <nav className="m-tabs" aria-label="Huvudmeny">
      <TabLink item={GUEST_HOME} icon={Home} active={isActive(pathname, GUEST_HOME)} />
      <TabLink item={GUEST_PRICES} icon={Tag} active={isActive(pathname, GUEST_PRICES)} />
      <SearchTab pathname={pathname} onOpen={() => openTopbarSearch(router)} />
      <TabLink item={GUEST_CALCULATOR} icon={Calculator} active={isActive(pathname, GUEST_CALCULATOR)} />
      <TabLink item={GUEST_GUIDES} icon={BookOpen} active={isActive(pathname, GUEST_GUIDES)} />
    </nav>
  );
}

// Focus must happen inside the tap itself, or iOS will not raise the keyboard.
function openTopbarSearch(router: ReturnType<typeof useRouter>) {
  const input = document.getElementById(TOPBAR_SEARCH_ID);
  if (input instanceof HTMLInputElement) {
    input.focus();
    input.select();
    return;
  }
  router.push('/search/');
}

function SearchTab({ pathname, onOpen }: { pathname: string | null; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="center"
      onClick={onOpen}
      aria-current={pathname?.startsWith('/search') ? 'page' : undefined}
    >
      <span className="icn"><Search size={22} strokeWidth={1.5} aria-hidden="true" /></span>
      Sök
    </button>
  );
}

function AppTabBar() {
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

  function openSearch() {
    setOpenOn(null);
    openTopbarSearch(router);
  }

  const moreActive = MORE_ITEMS.some(item => isActive(pathname, item));

  return (
    <nav className="m-tabs" aria-label="Huvudmeny">
      <TabLink item={HEM} icon={Home} active={isActive(pathname, HEM)} />
      <TabLink item={BIBLIOTEK} icon={LayoutGrid} active={isActive(pathname, BIBLIOTEK)} />
      <SearchTab pathname={pathname} onOpen={openSearch} />
      <TabLink item={KALENDER} icon={Calendar} active={isActive(pathname, KALENDER)} />
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
