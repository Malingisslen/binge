'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Calendar, Search, BarChart3, User } from 'lucide-react';

// Mobile bottom tab bar. The deliberate platform inversion: Sök is the center
// tab in the thumb zone — answering "is X on a Swedish streamer?" is the
// most common mobile act, so it gets the most reachable button.

type Tab = {
  label: string;
  href: string;
  icon: typeof LayoutGrid;
  matches?: readonly string[];
  center?: boolean;
};

const TABS: readonly Tab[] = [
  { label: 'Bibl',  href: '/my/all/',    icon: LayoutGrid, matches: ['/my/', '/series', '/films'] },
  { label: 'Kal',   href: '/calendar/',  icon: Calendar },
  { label: 'Sök',   href: '/search/',    icon: Search, center: true },
  { label: 'Råd',   href: '/savings/',   icon: BarChart3 },
  { label: 'Mig',   href: '/settings/',  icon: User, matches: ['/my/friends', '/feed', '/grupper', '/tillsammans', '/user/'] },
];

export default function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav className="m-tabs" aria-label="Huvudmeny">
      {TABS.map(t => {
        const Icon = t.icon;
        const active = isActive(pathname, t);
        return (
          <Link
            key={t.label}
            href={t.href}
            className={`${t.center ? 'center' : ''}${active && !t.center ? ' is-on' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="icn"><Icon size={22} strokeWidth={1.5} /></span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

function isActive(pathname: string | null, tab: Tab): boolean {
  if (!pathname) return false;
  if (pathname === tab.href) return true;
  if (pathname.startsWith(tab.href)) return true;
  if (tab.matches) {
    for (const prefix of tab.matches) {
      if (pathname.startsWith(prefix)) return true;
    }
  }
  return false;
}
