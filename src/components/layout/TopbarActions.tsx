'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { useFriendActions } from '@/hooks/useFriends';
import { useMySessions } from '@/hooks/useMySessions';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useSenderProfile } from '@/hooks/useSenderProfile';
import { getProvider } from '@/lib/tmdb/providers';
import { rememberNextPath } from '@/lib/nextPath';
import type { FriendRequest } from '@/lib/firebase/friends';

// Right-hand cluster of the new topbar: sessions popover, notifications bell
// popover, and the user avatar (or "Logga in" if signed out). Extracted from
// the legacy TopBar so the notification UX is preserved verbatim while the
// chrome around it changes — keeps Sentry-shaped logic untouched in Phase 1.

export default function TopbarActions() {
  const { user, uid, loading: authLoading, signOut, markNotificationsSeen } = useAuth();
  const router = useRouter();
  const {
    notifications, friendRequests, recentPicks,
    unreadCount, friendRequestsCount, providerUnreadCount, recentPicksCount,
    markRead, markAllRead,
  } = useNotifications();
  const { acceptFriendRequest, declineFriendRequest } = useFriendActions();
  const mySessions = useMySessions();
  const [bellOpen, setBellOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const avatarBtnRef = useRef<HTMLButtonElement>(null);
  const closeBell = useCallback(() => setBellOpen(false), []);
  const closeSessions = useCallback(() => setSessionsOpen(false), []);
  const closeUserMenu = useCallback(() => setUserMenuOpen(false), []);
  useClickOutside(bellRef, closeBell);
  useClickOutside(sessionsRef, closeSessions);
  useClickOutside(userMenuRef, closeUserMenu);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleBell = () => {
    const next = !bellOpen;
    setBellOpen(next);
    if (next && recentPicksCount > 0) {
      void markNotificationsSeen();
    }
  };

  const hasNotifications =
    friendRequestsCount > 0 || recentPicksCount > 0 || notifications.length > 0;
  // G7: badgen visar antal *sessioner* med osvepta kandidater — inte summan
  // av kvarvarande svep (29 osvepta i en session ska inte se ut som 29
  // notiser). Per-session-svepräknarna finns kvar i popover-raderna.
  const pendingSessions = mySessions.filter(s => s.pendingCount > 0).length;
  const pendingLabel = pendingSessions === 1
    ? '1 session med osvepta titlar'
    : `${pendingSessions} sessioner med osvepta titlar`;

  return (
    <div className="topbar-actions">
      {mounted && mySessions.length > 0 && (
        <div className="relative" ref={sessionsRef}>
          <button
            type="button"
            onClick={() => setSessionsOpen(!sessionsOpen)}
            className="topbar-icon-btn"
            title={pendingSessions > 0 ? pendingLabel : 'Mina sessioner'}
            aria-label={pendingSessions > 0 ? `Mina sessioner, ${pendingLabel}` : 'Mina sessioner'}
            aria-expanded={sessionsOpen}
          >
            <Users size={16} aria-hidden="true" />
            {pendingSessions > 0 && (
              <span className="topbar-badge">{pendingSessions > 9 ? '9+' : pendingSessions}</span>
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
                    <FriendRequestRow
                      key={r.fromUid}
                      request={r}
                      onAccept={() => acceptFriendRequest(r.fromUid)}
                      onDecline={() => declineFriendRequest(r.fromUid)}
                    />
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
                    // BIN-163 veckodigest — rollup-kort, inte tmdbId-formad.
                    // Länkar till biblioteket istället för en titelsida.
                    if (n.kind === 'weekly_digest') {
                      return (
                        <Link
                          key={n.id}
                          href="/my/all"
                          onClick={() => { markRead(n.id); setBellOpen(false); }}
                          className={`popover-row${n.read ? '' : ' is-unread'}`}
                        >
                          <div className="popover-row-title">Din streamingvecka</div>
                          <div className="popover-row-meta">{n.summary}</div>
                        </Link>
                      );
                    }
                    // BINGE-9: system-notiser (admin-varningar från backend, t.ex.
                    // Cineasterna-synk) är inte tmdbId-formade — länka till deras
                    // actionUrl och visa body, aldrig en /tv/undefined-titel+länk.
                    if (n.kind === 'system') {
                      return (
                        <Link
                          key={n.id}
                          href={n.actionUrl || '/insikter'}
                          onClick={() => { markRead(n.id); setBellOpen(false); }}
                          className={`popover-row${n.read ? '' : ' is-unread'}`}
                        >
                          <div className="popover-row-title">{n.title}</div>
                          {n.body && <div className="popover-row-meta">{n.body}</div>}
                        </Link>
                      );
                    }
                    const provider = n.providerId != null ? getProvider(n.providerId) : undefined;
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
                          {n.kind === 'episode_release' ? (
                            <>Nytt avsnitt{n.episodeCode ? ` ${n.episodeCode}` : ''}</>
                          ) : n.kind === 'digital_release' ? (
                            // Time-neutral: the card persists in the inbox for days,
                            // so it must not keep claiming "idag" after release day.
                            <>Digitalt släpp</>
                          ) : (
                            <>
                              Finns nu på{' '}
                              <span style={{ color: provider?.color ?? 'var(--ink-3)' }}>{n.providerName}</span>
                            </>
                          )}
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
      {user ? (
        // S1: avataren öppnar en kontomeny (samma popover-mönster som
        // klockan/sessionerna) istället för att hoppa direkt till
        // /settings — "Min profil" var tidigare onåbar från appens krom.
        <div
          className="relative"
          ref={userMenuRef}
          onKeyDown={e => {
            if (e.key === 'Escape' && userMenuOpen) {
              setUserMenuOpen(false);
              avatarBtnRef.current?.focus();
            }
          }}
        >
          <button
            ref={avatarBtnRef}
            type="button"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="topbar-avatar-link topbar-avatar-btn"
            aria-label={`Kontomeny (${user.displayName})`}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
          >
            <div className="avatar">{user.displayName.charAt(0).toUpperCase()}</div>
          </button>
          {userMenuOpen && (
            <div className="topbar-popover" role="menu" aria-label="Kontomeny">
              {/* "Min profil" kräver ett claimat username — utan det finns
                  ingen publik profil-URL att länka till. */}
              {user.username && (
                <Link
                  href={`/user/${user.username}/`}
                  role="menuitem"
                  className="popover-row"
                  onClick={closeUserMenu}
                >
                  <div className="popover-row-title">Min profil</div>
                  <div className="popover-row-meta">@{user.username}</div>
                </Link>
              )}
              <Link href="/stats/" role="menuitem" className="popover-row" onClick={closeUserMenu}>
                <div className="popover-row-title">Statistik</div>
              </Link>
              <Link href="/settings/" role="menuitem" className="popover-row" onClick={closeUserMenu}>
                <div className="popover-row-title">Inställningar</div>
              </Link>
              <button
                type="button"
                role="menuitem"
                className="popover-row popover-row-btn"
                onClick={() => { closeUserMenu(); void signOut(); }}
              >
                <div className="popover-row-title">Logga ut</div>
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/*
            Avatar-skelett som *alltid* renderas server-side när !user. CSS
            i globals.css döljer den för anonyma users men visar den för
            returning users (.returning-user-klassen sätts av inline-script
            i <head>). Eliminerar empty → skelett → avatar-flickern: så
            fort first paint sker har returning users redan avatar-formen.
            När auth resolveras byts hela `!user`-grenen mot Link-grenen ovan.
          */}
          <div className="topbar-avatar-link topbar-avatar-skeleton" aria-hidden="true">
            <div className="avatar" />
          </div>
          {mounted && !authLoading && !uid && (
            // Anonym + auth resolverad → "Logga in". CSS gör att denna och
            // skelettet inte krockar (skeleton hidden för anonyma).
            // !uid-villkoret: profilen laddas parallellt efter auth-beskedet,
            // så user kan vara null en RTT trots inloggad — visa skelettet
            // (grenen ovanför) istället för en "Logga in"-flicker.
            <button
              onClick={() => {
                // BIN-668 (BIN-645's rule, second call site): never call signIn()
                // from the chrome. A first-time Google sign-in CREATES the
                // account, and account creation stamps termsAcceptedAt +
                // ageConfirmedAt (13+) — but the villkor link and the 13-års-
                // notisen live on /login. Signing in straight from the topbar
                // recorded a consent the visitor was never shown.
                //
                // The return path rides in sessionStorage, not a ?next= param —
                // see nextPath.ts: a query param would travel to Firebase's
                // Google-hosted auth handler and disclose the page she was on.
                //
                // location, not usePathname(): the topbar renders on /search,
                // whose entire state is the ?q= query, so dropping the search
                // would return her to an empty page. Safe here — this is a click
                // handler, never render.
                rememberNextPath(window.location.pathname + window.location.search);
                router.push('/login/');
              }}
              className="topbar-signin-btn"
            >
              Logga in
            </button>
          )}
        </>
      )}
    </div>
  );
}

function FriendRequestRow({
  request,
  onAccept,
  onDecline,
}: {
  request: FriendRequest;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { data: sender } = useSenderProfile(request.fromUid);
  const displayName = sender?.displayName ?? request.fromDisplayName;
  const username = sender?.username ?? request.fromUsername;
  return (
    <div className="popover-row friend-req">
      <div className="popover-row-title">{displayName}</div>
      {username && <div className="popover-row-meta">@{username}</div>}
      <div className="popover-actions">
        <button onClick={onAccept} className="btn btn-sm btn-acc">
          Acceptera
        </button>
        <button onClick={onDecline} className="btn btn-sm btn-ghost">
          Avböj
        </button>
      </div>
    </div>
  );
}
