'use client';

import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useMyGroups } from '@/hooks/useGroups';
import { useMySessions } from '@/hooks/useMySessions';

// Right rail's Grupper tile. Shows up to 3 groups; if any of them has an
// active Tillsammans session right now, that row gets the pulsing saffran
// dot. Otherwise just an inert dot. Empty state links to /grupper/ny/.

function formatRelative(date: Date | unknown): string {
  // Defensive coercion — se kommentar i VannerTile.formatSince.
  const d = toDate(date);
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  const hours = Math.round(diff / (1000 * 60 * 60));
  if (hours < 1) return 'precis nu';
  if (hours < 24) return `${hours} t sen`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d sen`;
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

function toDate(val: unknown): Date | null {
  if (val instanceof Date) return val;
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: unknown }).toDate === 'function') {
    try { return (val as { toDate: () => Date }).toDate(); } catch { return null; }
  }
  if (typeof val === 'number') return new Date(val);
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export default function GrupperTile() {
  const { uid } = useAuth();
  const { groups, loading } = useMyGroups(uid);
  const sessions = useMySessions();

  // Map sessionId → groupId is not directly available from useMySessions,
  // but tracked sessions started from a group page mark the row as live via
  // the participantId on the session itself. For now we approximate: if
  // ANY active session exists, the most recently updated group gets the dot.
  // Cleaner mapping comes later — this is non-blocking for the visual.
  const hasLiveSession = sessions.length > 0;

  if (loading) return null;

  return (
    <section className="tile grupp" aria-label="Grupper">
      <div className="h">
        <span>Grupper</span>
        <Link href="/grupper/" className="more">alla →</Link>
      </div>
      {groups.length === 0 ? (
        <div className="empty">
          Du är inte med i någon grupp än.{' '}
          <Link href="/grupper/ny/">Skapa en →</Link>
        </div>
      ) : (
        <>
          {groups.slice(0, 3).map((g, i) => {
            const live = hasLiveSession && i === 0;
            return (
              <Link key={g.id} href={`/grupper/${g.id}/`} className="row">
                <span className={`dot${live ? ' on' : ''}`} aria-hidden="true" />
                <span className="nm">{g.name}</span>
                <span className="ct">
                  {live ? 'röstar nu' : `senast ${formatRelative(g.updatedAt)}`}
                </span>
              </Link>
            );
          })}
        </>
      )}
    </section>
  );
}
