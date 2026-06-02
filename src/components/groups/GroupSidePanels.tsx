'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, LogOut, RefreshCw } from 'lucide-react';
import { getProvider } from '@/lib/tmdb/providers';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import {
  disableInviteToken,
  leaveGroup,
  rotateInviteToken,
} from '@/lib/firebase/groups';
import {
  cacheInviteToken,
  clearInviteToken,
  readInviteToken,
} from '@/lib/groupInviteCache';
import { useMountTime } from '@/hooks/useMountTime';

/**
 * Sidopaneler i grupp-layouten som tillsammans varit ~200 rader inline
 * i GroupPageClient. Flyttade hit för att main-filen ska kunna fokusera
 * på orchestrering.
 *
 * ProviderOverlapPanel — visar intersect (alla har) + union (någon har)
 * InvitePanel — inbjudningslänk med kopiera/generera/inaktivera
 * LeavePanel — en röd "Lämna gruppen"-knapp
 * ProviderPills — återanvändbar provider-pill-display
 */

export function ProviderOverlapPanel({ intersect, union }: { intersect: number[]; union: number[] }) {
  const intersectSet = useMemo(() => new Set(intersect), [intersect]);
  const onlySome = useMemo(() => union.filter(id => !intersectSet.has(id)), [union, intersectSet]);

  return (
    <div className="bg-surface border border-border-main rounded-sm">
      <div className="px-3 py-[6px] border-b border-border-light text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold">
        Streamingöverlapp
      </div>
      <div className="px-3 py-2 space-y-2">
        <div>
          <div className="text-xxs text-text-muted mb-1">Alla har ({intersect.length})</div>
          <ProviderPills ids={intersect} highlight />
        </div>
        <div>
          <div className="text-xxs text-text-muted mb-1">Någon har ({union.length})</div>
          <ProviderPills ids={onlySome} />
        </div>
        <JustWatchCredit className="block pt-1" />
      </div>
    </div>
  );
}

export function ProviderPills({ ids, highlight = false }: { ids: number[]; highlight?: boolean }) {
  if (ids.length === 0) {
    return <div className="text-xxs text-text-muted">—</div>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map(id => {
        const p = getProvider(id);
        if (!p) return null;
        return (
          <span
            key={id}
            className={`inline-flex items-center gap-1 px-[5px] py-[1px] text-xxs border rounded-sm ${
              highlight ? 'border-accent text-accent' : 'border-border-main text-text-muted'
            }`}
          >
            <span className="w-[5px] h-[5px] rounded-full" style={{ background: p.color }} />
            {p.shortName}
          </span>
        );
      })}
    </div>
  );
}

// Antal dagar innan vi nudge:ar om att rotera inbjudningslänken. Efter en
// inbjudningslänk legat ute längre än så ökar sannolikheten att den läckt
// till någon som inte längre hör hemma i gruppen.
const TOKEN_STALE_DAYS = 180;

// Plaintext-tokenet finns inte längre på Firestore (bara hash). Vi cachar
// plaintext i localStorage per groupId så ägaren kan återbesöka panel:n och
// kopiera länken igen. På en ny enhet syns inte länken — då måste ägaren
// rotera för att få en ny synlig plaintext.
export function InvitePanel({
  groupId, group,
}: {
  groupId: string;
  group: { inviteTokenHash: string | null; inviteTokenRotatedAt?: Date | null };
}) {
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);
  const [cachedPlaintext, setCachedPlaintext] = useState<string | null>(null);

  // Läs cache lazy på client (undviker SSR-mismatch)
  useEffect(() => {
    setCachedPlaintext(readInviteToken(groupId));
  }, [groupId]);

  // Token är aktivt så länge hash finns på doc:et
  const tokenIsActive = group.inviteTokenHash !== null;

  const inviteUrl = useMemo(() => {
    if (!tokenIsActive || !cachedPlaintext) return null;
    if (typeof window === 'undefined') return null;
    return `${window.location.origin}/grupper/${groupId}?invite=${cachedPlaintext}`;
  }, [tokenIsActive, cachedPlaintext, groupId]);

  const now = useMountTime();
  const tokenAgeDays = now !== null && group.inviteTokenRotatedAt
    ? Math.floor((now - group.inviteTokenRotatedAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;
  const isStale = tokenAgeDays !== null && tokenAgeDays >= TOKEN_STALE_DAYS;

  const copy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const handleRotate = async () => {
    setWorking(true);
    try {
      const plaintext = await rotateInviteToken(groupId);
      cacheInviteToken(groupId, plaintext);
      setCachedPlaintext(plaintext);
    } finally {
      setWorking(false);
    }
  };

  const handleDisable = async () => {
    if (!confirm('Inaktivera inbjudningslänken? Befintliga länkar slutar fungera.')) return;
    setWorking(true);
    try {
      await disableInviteToken(groupId);
      clearInviteToken(groupId);
      setCachedPlaintext(null);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="bg-surface border border-border-main rounded-sm">
      <div className="px-3 py-[6px] border-b border-border-light text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold">
        Inbjudningslänk
      </div>
      <div className="px-3 py-2 space-y-2">
        {inviteUrl ? (
          <>
            <div className="flex gap-1">
              <input
                readOnly
                value={inviteUrl}
                className="flex-1 px-2 py-1 text-xxs border border-border-main rounded-sm bg-white truncate"
                onFocus={e => e.currentTarget.select()}
              />
              <button
                onClick={copy}
                className="px-2 py-1 border border-border-main rounded-sm text-xxs bg-white cursor-pointer"
                title="Kopiera"
              >
                <Copy size={11} />
              </button>
            </div>
            {copied && <div className="text-xxs text-accent">Kopierad.</div>}
            {isStale && (
              <div className="text-xxs text-amber-700 bg-amber-50 border border-amber-200 rounded-sm px-2 py-1">
                Länken är {tokenAgeDays} dagar gammal. Generera en ny om du misstänker att den läckt.
              </div>
            )}
            <div className="flex gap-1">
              <button
                onClick={handleRotate}
                disabled={working}
                className="inline-flex items-center gap-1 px-2 py-1 border border-border-main rounded-sm text-xxs bg-white cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={10} /> Generera ny
              </button>
              <button
                onClick={handleDisable}
                disabled={working}
                className="px-2 py-1 border border-border-main rounded-sm text-xxs bg-white cursor-pointer disabled:opacity-50"
              >
                Inaktivera
              </button>
            </div>
          </>
        ) : tokenIsActive ? (
          <>
            <p className="text-xxs text-text-muted leading-relaxed">
              En aktiv inbjudningslänk finns men plaintext-värdet är inte sparat på den
              här enheten — av säkerhetsskäl lagras det bara client-side. Generera en ny
              för att få en synlig länk att kopiera. Den gamla länken slutar då fungera.
            </p>
            <div className="flex gap-1">
              <button
                onClick={handleRotate}
                disabled={working}
                className="inline-flex items-center gap-1 px-2 py-1 border border-border-main rounded-sm text-xxs bg-white cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={10} /> Generera ny
              </button>
              <button
                onClick={handleDisable}
                disabled={working}
                className="px-2 py-1 border border-border-main rounded-sm text-xxs bg-white cursor-pointer disabled:opacity-50"
              >
                Inaktivera
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xxs text-text-muted">Ingen aktiv inbjudningslänk.</p>
            <button
              onClick={handleRotate}
              disabled={working}
              className="inline-flex items-center gap-1 px-2 py-1 border border-border-main rounded-sm text-xxs bg-white cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={10} /> Skapa länk
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function LeavePanel({
  groupId, myUid, onLeft,
}: {
  groupId: string;
  myUid: string;
  onLeft: () => void;
}) {
  const [working, setWorking] = useState(false);
  return (
    <div className="bg-surface border border-border-main rounded-sm">
      <div className="px-3 py-2">
        <button
          onClick={async () => {
            if (!confirm('Lämna gruppen?')) return;
            setWorking(true);
            try { await leaveGroup(groupId, myUid); onLeft(); } finally { setWorking(false); }
          }}
          disabled={working}
          className="inline-flex items-center gap-1 text-xs text-red-700 hover:underline cursor-pointer disabled:opacity-50"
        >
          <LogOut size={11} /> Lämna gruppen
        </button>
      </div>
    </div>
  );
}
