'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The horizontal section nav that lives directly below the topbar on every
// authenticated page. Order matches Direction H's subnav exactly:
// Hem · Bibliotek · Kalender · Rekommendationer · Streamingrådgivaren · Vänner · Grupper.

type NavItem = {
  label: string;
  href: string;
  // Subroute prefixes that should mark this item as active (each prefix is
  // matched with pathname.startsWith). The item's own href is matched
  // exactly in addition.
  matches?: readonly string[];
};

const ITEMS: readonly NavItem[] = [
  { label: 'Hem', href: '/' },
  { label: 'Bibliotek', href: '/my/all/', matches: ['/my/all', '/my/series', '/my/films', '/my/vill-se', '/my/avbrutna'] },
  { label: 'Kalender', href: '/calendar/' },
  { label: 'Rekommendationer', href: '/recommendations/', matches: ['/kalibrera'] },
  { label: 'Fråga Binge', href: '/ask/' },
  { label: 'Streamingrådgivaren', href: '/savings/' },
  { label: 'Vänner', href: '/my/friends/', matches: ['/feed', '/user/'] },
  { label: 'Grupper', href: '/grupper/', matches: ['/tillsammans/'] },
];

export default function Subnav() {
  const pathname = usePathname();

  return (
    <nav className="subnav" aria-label="Sektioner">
      {ITEMS.map(item => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.label}
            href={item.href}
            className={active ? 'is-on' : undefined}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function isActive(pathname: string | null, item: NavItem): boolean {
  if (!pathname) return false;
  if (item.href === '/') return pathname === '/' || pathname === '';
  if (pathname === item.href) return true;
  if (pathname.startsWith(item.href)) return true;
  if (item.matches) {
    for (const prefix of item.matches) {
      if (pathname.startsWith(prefix)) return true;
    }
  }
  return false;
}
