'use client';

import Link from 'next/link';
import { AvatarInitials } from '@/components/ui/AvatarInitials';
import { useFriendsWhoSaw, type FriendWhoSaw } from '@/hooks/useFriendsWhoSaw';

/**
 * BIN-97 — kompakt rad med personer man följer som har titeln publikt.
 * Renderar inget om ingen följd har den (eller man inte är inloggad/följer
 * ingen) — datat är redan integritetsfiltrerat i useFriendsWhoSaw.
 */

const MAX_VISIBLE = 8;

function label(f: FriendWhoSaw): string {
  if (f.rating != null) return `${f.rating}★`;
  switch (f.status) {
    case 'sedd': return 'sett';
    case 'vill_se': return 'vill se';
    case 'mina': return 'följer';
    case 'avbruten': return 'avbröt';
    default: return '';
  }
}

export default function FriendsWhoSaw({ tmdbId }: { tmdbId: number }) {
  const { data } = useFriendsWhoSaw(tmdbId);
  if (!data || data.length === 0) return null;

  const visible = data.slice(0, MAX_VISIBLE);
  const overflow = data.length - visible.length;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
      <span style={{ fontSize: 10.5, letterSpacing: 0.12, textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        vänner som sett detta
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {visible.map(f => {
          // Bara https-URLer i <img src> — en användares photoURL kan vara en
          // data:-URI (potentiell XSS-vektor); allt annat faller till initialer.
          const safePhoto = f.photoURL && f.photoURL.startsWith('https://') ? f.photoURL : null;
          const inner = (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {safePhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={safePhoto} alt={f.displayName} width={22} height={22} loading="lazy" decoding="async"
                  style={{ width: 22, height: 22, borderRadius: 999, border: '1px solid var(--rule)', objectFit: 'cover' }} />
              ) : (
                <AvatarInitials name={f.displayName} size={22} />
              )}
              <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{f.displayName}</span>
              {label(f) && (
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{label(f)}</span>
              )}
            </span>
          );
          return f.username ? (
            <Link key={f.uid} href={`/user/${f.username}/`} style={{ textDecoration: 'none', color: 'inherit' }}>
              {inner}
            </Link>
          ) : (
            <span key={f.uid}>{inner}</span>
          );
        })}
        {overflow > 0 && (
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>+{overflow}</span>
        )}
      </div>
    </div>
  );
}
