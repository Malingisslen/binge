'use client';

import Link from 'next/link';
import { useFriends } from '@/hooks/useFriends';

// Right rail's Vänner tile. The Direction H mockup shows a recent-activity
// feed ("Johan släppte Mörker efter S1E03", "Sara gav Bron betyget 4,5"),
// but the data layer doesn't aggregate activity events yet. For now this
// tile shows the most recent friends (newest at top) — same shape, link
// each row to their profile. Replace with real activity items in a later
// pass when the feed-event hook exists.

function formatSince(date: Date): string {
  const diff = Date.now() - date.getTime();
  const days = Math.round(diff / (1000 * 60 * 60 * 24));
  if (days < 1) return 'i dag';
  if (days < 7) return `${days} d sen`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return `${weeks} v sen`;
  }
  return date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

export default function VannerTile() {
  const { data: friends, isLoading } = useFriends();

  if (isLoading) return null;

  return (
    <section className="tile vanner" aria-label="Vänner">
      <div className="h">
        <span>Vänner</span>
        <Link href="/my/friends/" className="more">alla →</Link>
      </div>
      {!friends || friends.length === 0 ? (
        <div className="empty" style={{ fontSize: 13, color: 'var(--ink-3)', padding: '6px 0', lineHeight: 1.4 }}>
          Du har inga vänner än.{' '}
          <Link href="/search/" style={{ color: 'var(--ink)', textDecoration: 'none', borderBottom: '1px solid var(--rule)' }}>
            Sök efter någon →
          </Link>
        </div>
      ) : (
        <ul className="tile-list">
          {friends.slice(0, 4).map(f => {
            const initial = (f.displayName?.[0] ?? '?').toUpperCase();
            const profileHref = f.username ? `/user/${f.username}/` : `/my/friends/`;
            return (
              <li key={f.uid}>
                <Link href={profileHref} className="av" aria-label={f.displayName}>
                  {initial}
                </Link>
                <div className="txt">
                  <strong>{f.displayName}</strong>
                  {f.username && (
                    <span className="when">@{f.username}</span>
                  )}
                  <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: 10.5, marginTop: 2, letterSpacing: 0.04 }}>
                    blev vän {formatSince(f.since)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
