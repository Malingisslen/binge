'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { Bell, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { useFriendActions } from '@/hooks/useFriends';
import { useMySessions } from '@/hooks/useMySessions';
import { useClickOutside } from '@/hooks/useClickOutside';
import { getProvider } from '@/lib/tmdb/providers';

export default function TopBar() {
  const { user, signIn, markNotificationsSeen } = useAuth();
  const {
    notifications, friendRequests, recentPicks,
    unreadCount, friendRequestsCount, providerUnreadCount, recentPicksCount,
    markRead, markAllRead,
  } = useNotifications();
  const { acceptFriendRequest, declineFriendRequest } = useFriendActions();
  const mySessions = useMySessions();
  const [bellOpen, setBellOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef<HTMLDivElement>(null);
  const closeBell = useCallback(() => setBellOpen(false), []);
  const closeSessions = useCallback(() => setSessionsOpen(false), []);
  useClickOutside(bellRef, closeBell);
  useClickOutside(sessionsRef, closeSessions);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Vid öppning: markera "sett" — kollapsar recent-picks-räkningen. Friend
  // requests har egen action-required-räkning som inte påverkas.
  const toggleBell = () => {
    const next = !bellOpen;
    setBellOpen(next);
    if (next && recentPicksCount > 0) {
      void markNotificationsSeen();
    }
  };

  const hasNotifications =
    friendRequestsCount > 0 || recentPicksCount > 0 || notifications.length > 0;
  const totalPending = mySessions.reduce((s, sess) => s + sess.pendingCount, 0);

  return (
    <div className="flex items-center justify-end px-[18px] py-[8px] bg-surface border-b border-border-main">
      <div className="flex items-center gap-[8px] text-sm text-text-muted">
        {mounted && mySessions.length > 0 && (
          <div className="relative" ref={sessionsRef}>
            <button
              type="button"
              onClick={() => setSessionsOpen(!sessionsOpen)}
              className="relative bg-transparent border-none cursor-pointer p-0 text-text-muted hover:text-text-secondary"
              title={totalPending > 0 ? `${totalPending} väntande svepningar` : 'Mina sessioner'}
              aria-label={totalPending > 0 ? `Mina sessioner, ${totalPending} väntande svepningar` : 'Mina sessioner'}
              aria-expanded={sessionsOpen}
            >
              <Users size={16} aria-hidden="true" />
              {totalPending > 0 && (
                <span className="absolute -top-[3px] -right-[3px] w-[14px] h-[14px] bg-accent text-white rounded-full text-[8px] flex items-center justify-center font-bold">
                  {totalPending > 9 ? '9+' : totalPending}
                </span>
              )}
            </button>
            {sessionsOpen && (
              <div className="absolute right-0 top-full mt-1 w-[280px] bg-surface border border-border-main rounded-sm z-50 max-h-[300px] overflow-y-auto">
                <div className="flex items-center justify-between px-2 py-[4px] border-b border-border-light">
                  <span className="text-xxs font-semibold text-text-muted uppercase">Pågående sessioner</span>
                </div>
                {mySessions.map(s => (
                  <Link
                    key={s.sessionId}
                    href={`/tillsammans/${s.sessionId}/`}
                    onClick={() => setSessionsOpen(false)}
                    className={`block px-2 py-[5px] border-b border-border-light no-underline hover:bg-surface-hover ${
                      s.pendingCount > 0 ? 'bg-accent/5' : ''
                    }`}
                  >
                    <div className="text-xs text-text-primary font-semibold truncate">{s.hostName}</div>
                    <div className="text-xxs text-text-muted">
                      {s.pendingCount > 0
                        ? `${s.pendingCount} kvar att svepa av ${s.totalCandidates}`
                        : `Alla svepta (${s.totalCandidates})`}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
        {mounted && user && hasNotifications && (
          <div className="relative" ref={bellRef}>
            <button
              type="button"
              onClick={toggleBell}
              className="relative bg-transparent border-none cursor-pointer p-0 text-text-muted hover:text-text-secondary"
              aria-label={unreadCount > 0 ? `Notiser, ${unreadCount} olästa` : 'Notiser'}
              aria-expanded={bellOpen}
            >
              <Bell size={16} aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="absolute -top-[3px] -right-[3px] w-[14px] h-[14px] bg-accent text-white rounded-full text-[8px] flex items-center justify-center font-bold">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="absolute right-0 top-full mt-1 w-[300px] bg-surface border border-border-main rounded-sm z-50 max-h-[400px] overflow-y-auto">
                {/* Friend requests */}
                {friendRequestsCount > 0 && (
                  <>
                    <div className="px-2 py-[4px] border-b border-border-light bg-accent/[0.04]">
                      <span className="text-xxs font-semibold text-text-muted uppercase">
                        Vänskapsförfrågningar ({friendRequestsCount})
                      </span>
                    </div>
                    {friendRequests.slice(0, 5).map(r => (
                      <div key={r.fromUid} className="px-2 py-[6px] border-b border-border-light flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-text-primary font-semibold truncate">
                            {r.fromDisplayName}
                          </div>
                          {r.fromUsername && (
                            <div className="text-xxs text-text-muted">@{r.fromUsername}</div>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => acceptFriendRequest(r.fromUid)}
                            className="px-[6px] py-[2px] text-xxs border border-accent bg-accent text-white rounded-sm cursor-pointer font-[inherit]"
                          >
                            Acceptera
                          </button>
                          <button
                            onClick={() => declineFriendRequest(r.fromUid)}
                            className="px-[6px] py-[2px] text-xxs border border-border-main bg-surface text-text-muted rounded-sm cursor-pointer font-[inherit]"
                          >
                            Avböj
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {/* Senaste filmkvällar */}
                {recentPicksCount > 0 && (
                  <>
                    <div className="px-2 py-[4px] border-b border-border-light bg-accent/[0.04]">
                      <span className="text-xxs font-semibold text-text-muted uppercase">
                        Senaste filmkvällar ({recentPicksCount})
                      </span>
                    </div>
                    {recentPicks.slice(0, 5).map(p => (
                      <Link
                        key={p.sessionId}
                        href={`/grupper/${p.groupId}/`}
                        onClick={() => setBellOpen(false)}
                        className="block px-2 py-[5px] border-b border-border-light no-underline hover:bg-surface-hover"
                      >
                        <div className="text-xs text-text-primary font-semibold truncate">
                          {p.mediaTitle}
                        </div>
                        <div className="text-xxs text-text-muted">
                          Vald i <span className="text-accent">{p.groupName}</span>
                        </div>
                      </Link>
                    ))}
                  </>
                )}

                {/* Provider-availability */}
                {notifications.length > 0 && (
                  <>
                    <div className="flex items-center justify-between px-2 py-[4px] border-b border-border-light bg-accent/[0.04]">
                      <span className="text-xxs font-semibold text-text-muted uppercase">Streamingnyheter</span>
                      {providerUnreadCount > 0 && (
                        <button
                          onClick={markAllRead}
                          className="text-xxs text-accent bg-transparent border-none cursor-pointer font-[inherit]"
                        >
                          Markera alla lästa
                        </button>
                      )}
                    </div>
                    {notifications.slice(0, 10).map(n => {
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
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {mounted && user ? (
          <Link href="/settings" className="flex items-center gap-[6px] no-underline text-text-muted hover:text-text-secondary">
            <div className="w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center text-xxs font-bold">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm">{user.displayName}</span>
          </Link>
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
