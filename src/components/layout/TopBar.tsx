'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';

const TABS = [
  { label: 'Dashboard', href: '/' },
  { label: 'Kalender', href: '/calendar' },
  { label: 'Serier', href: '/series/' },
  { label: 'Filmer', href: '/films/' },
];

export default function TopBar() {
  const pathname = usePathname();
  const { user, signIn } = useAuth();

  return (
    <div className="flex items-center justify-between px-[18px] py-[6px] bg-surface border-b border-border-main">
      <div className="flex">
        {TABS.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`text-sm px-3 py-[6px] border-b-2 no-underline cursor-pointer hover:text-text-secondary ${
              pathname === tab.href
                ? 'text-accent border-b-accent font-semibold'
                : 'text-text-muted border-b-transparent'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-[5px] text-sm text-text-muted">
        {user ? (
          <>
            <div className="w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center text-xxs font-bold">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            {user.displayName}
          </>
        ) : (
          <button
            onClick={signIn}
            className="text-accent bg-transparent border-none cursor-pointer font-[inherit] text-sm"
          >
            Logga in
          </button>
        )}
      </div>
    </div>
  );
}
