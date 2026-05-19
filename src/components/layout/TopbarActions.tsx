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

// Right-hand cluster of the new topbar: sessions popover, notifications bell
// popover, and the user avatar (or "Logga in" if signed out). Extracted from
// the legacy TopBar so the notification UX is preserved verbatim while the
// chrome around it changes — keeps Sentry-shaped logic untouched in Phase 1.

export default function TopbarActions() {
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
    <div className="topbar-actions">
      {mounted && mySessions.length > 0 && (
        <div className="relative" ref={sessionsRef}>
          <button
            type="button"
            onClick={() => setSessionsOpen(!sessionsOpen)}
            className="topbar-icon-btn"
            title={totalPending > 0 ? `${totalPending} väntande svepningar` : 'Mina sessioner'}
            aria-label={totalPending > 0 ? `Mina sessioner, ${totalPending} väntande svepningar` : 'Mina sessioner'}
            aria-expanded={sessionsOpen}
          >
            <Users size={16} aria-hidden="true" />
            {totalPending > 0 && (
              <span className="topbar-badge">{totalPending > 9 ? '9+' : totalPending}</span>
            )}
          </button>
          {sessionsOpen && (
            <div className="topbar-popover" role="dialog" aria-label="Pågående sessioner">
              <div className="popover-head">Pågående sessioner</div>
              {mySessions.map(s => (
                <Link
                  key={s.sessionId}
                  href={`/tillsammans/${s.sessionId}/`}
                  onClick={() => setSessionsOpen(false)}
                  className={`popover-row${s.pendingCount > 0 ? ' is-pending' : ''}`}
                >
                  <div className="popover-row-title">{s.hostName}</div>
                  <div className="popover-row-meta">
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
            className="topbar-icon-btn"
            aria-label={unreadCount > 0 ? `Notiser, ${unreadCount} olästa` : 'Notiser'}
            aria-expanded={bellOpen}
          >
            <Bell size={16} aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="topbar-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </button>
          {bellOpen && (
            <div className="topbar-popover wide" role="dialog" aria-label="Notiser">
              {friendRequestsCount > 0 && (
                <>
                  <div className="popover-head">
                    Vänskapsförfrågningar ({friendRequestsCount})
                  </div>
                  {friendRequests.slice(0, 5).map(r => (
                    <div key={r.fromUid} className="popover-row friend-req">
                      <div className="popover-row-title">{r.fromDisplayName}</div>
                      {r.fromUsername && (
                        <div className="popover-row-meta">@{r.fromUsername}</div>
                      )}
                      <div className="popover-actions">
                        <button
                          onClick={() => acceptFriendRequest(r.fromUid)}
                          className="btn btn-sm btn-acc"
                        >
                          Acceptera
                        </button>
                        <button
                          onClick={() => declineFriendRequest(r.fromUid)}
                          className="btn btn-sm btn-ghost"
                        >
                          Avböj
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {recentPicksCount > 0 && (
                <>
                  <div className="popover-head">
                    Senaste filmkvällar ({recentPicksCount})
                  </div>
                  {recentPicks.slice(0, 5).map(p => (
                    <Link
                      key={p.sessionId}
                      href={`/grupper/${p.groupId}/`}
                      onClick={() => setBellOpen(false)}
                      className="popover-row"
                    >
                      <div className="popover-row-title">{p.mediaTitle}</div>
                      <div className="popover-row-meta">
                        Vald i <span className="acc-text">{p.groupName}</span>
                      </div>
                    </Link>
                  ))}
                </>
              )}
              {notifications.length > 0 && (
                <>
                  <div className="popover-head">
                    <span>Streamingnyheter</span>
                    {providerUnreadCount > 0 && (
                      <button onClick={markAllRead} className="popover-action-link">
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
                        className={`popover-row${n.read ? '' : ' is-unread'}`}
                      >
                        <div className="popover-row-title">{n.title}</div>
                        <div className="popover-row-meta">
                          Finns nu på{' '}
                          <span style={{ color: provider?.color ?? 'var(--ink-3)' }}>{n.providerName}</span>
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
        <Link href="/settings/" className="topbar-avatar-link" aria-label={`Inställningar (${user.displayName})`}>
          <div className="avatar">{user.displayName.charAt(0).toUpperCase()}</div>
        </Link>
      ) : mounted ? (
        <button onClick={signIn} className="topbar-signin-btn">
          Logga in
        </button>
      ) : null}
    </div>
  );
}
