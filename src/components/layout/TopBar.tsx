'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { useClickOutside } from '@/hooks/useClickOutside';
import { getProvider } from '@/lib/tmdb/providers';

const TABS = [
  { label: 'Dashboard', href: '/' },
  { label: 'Kalender', href: '/calendar' },
  { label: 'Serier', href: '/series/' },
  { label: 'Filmer', href: '/films/' },
];

export default function TopBar() {
  const pathname = usePathname();
  const { user, signIn } = useAuth();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const closeBell = useCallback(() => setBellOpen(false), []);
  useClickOutside(bellRef, closeBell);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex items-center justify-between px-[18px] py-[6px] bg-surface border-b border-border-main">
      <div className="flex">
        {TABS.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`text-sm px-3 py-[6px] border-b-2 no-underline cursor-pointer hover:text-text-secondary ${
              (tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href.replace(/\/$/, '')))
                ? 'text-accent border-b-accent font-semibold'
                : 'text-text-muted border-b-transparent'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-[8px] text-sm text-text-muted">
        {mounted && user && (
          <div className="relative" ref={bellRef}>
            <button
              onClick={() => setBellOpen(!bellOpen)}
              className="relative bg-transparent border-none cursor-pointer p-0 text-text-muted hover:text-text-secondary"
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="absolute -top-[3px] -right-[3px] w-[14px] h-[14px] bg-accent text-white rounded-full text-[8px] flex items-center justify-center font-bold">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="absolute right-0 top-full mt-1 w-[280px] bg-surface border border-border-main rounded-sm z-50 max-h-[300px] overflow-y-auto">
                <div className="flex items-center justify-between px-2 py-[4px] border-b border-border-light">
                  <span className="text-xxs font-semibold text-text-muted uppercase">Notiser</span>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-xxs text-accent bg-transparent border-none cursor-pointer font-[inherit]"
                    >
                      Markera alla lästa
                    </button>
                  )}
                </div>
                {notifications.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-text-muted text-center">Inga notiser</div>
                ) : (
                  notifications.slice(0, 20).map(n => {
                    const provider = getProvider(n.providerId);
                    const href = `/${n.mediaType === 'movie' ? 'movie' : 'tv'}/${n.tmdbId}/`;
                    return (
                      <Link
                        key={n.id}
                        href={href}
                        onClick={() => { markRead(n.id); setBellOpen(false); }}
                        className={`block px-2 py-[5px] border-b border-border-light no-underline hover:bg-surface-hover ${
                          n.read ? '' : 'bg-accent/5'
                        }`}
                      >
                        <div className="text-xs text-text-primary font-semibold">{n.title}</div>
                        <div className="text-xxs text-text-muted">
                          Finns nu på{' '}
                          <span style={{ color: provider?.color ?? '#888' }}>{n.providerName}</span>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
        {mounted && user ? (
          <>
            <div className="w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center text-xxs font-bold">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            {user.displayName}
          </>
        ) : mounted ? (
          <button
            onClick={signIn}
            className="text-accent bg-transparent border-none cursor-pointer font-[inherit] text-sm"
          >
            Logga in
          </button>
        ) : null}
      </div>
    </div>
  );
}
