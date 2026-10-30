'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useToWatchCount } from '@/hooks/useToWatchCount';

// The horizontal section nav that lives directly below the topbar on every
// authenticated page. Order: Hem · Mitt Binge · Kalender · Vänner · Rekommendationer ·
// Fråga Binge · Streamingrådgivaren.
// Grupper is out of the menus while the feature is paused (plan round 2, decision 4).

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
  { label: 'Mitt Binge', href: '/my/all/', matches: ['/my/all', '/my/series', '/my/films', '/my/vill-se', '/my/nytt-for-dig', '/my/avbrutna', '/my/lists'] },
  { label: 'Kalender', href: '/calendar/' },
  { label: 'Vänner', href: '/my/friends/', matches: ['/feed', '/user/'] },
  { label: 'Rekommendationer', href: '/recommendations/', matches: ['/kalibrera'] },
  { label: 'Fråga Binge', href: '/ask/' },
  { label: 'Streamingrådgivaren', href: '/savings/' },
];

export default function Subnav() {
  const pathname = usePathname();
  const toWatch = useToWatchCount();

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
            {item.label === 'Mitt Binge' && toWatch > 0 && (
              <>
                <span className="nav-count" aria-hidden="true">{toWatch > 99 ? '99+' : toWatch}</span>
                <span className="sr-only">, {toWatch} att se</span>
              </>
            )}
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
