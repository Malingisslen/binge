'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, LogOut, RefreshCw } from 'lucide-react';
import { getProvider } from '@/lib/tmdb/providers';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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
import {
  inviteTokenAgeDays,
  inviteTokenAgeLabel,
  shouldAutoRotateInviteToken,
  STALE_NUDGE_AFTER_DAYS,
} from '@/lib/groupInviteToken';

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
    <div className="bg-surface border border-rule rounded-sm">
      <div className="px-3 py-[6px] border-b border-rule-2 text-[10px] uppercase tracking-[0.5px] text-ink-3 font-semibold">
        Streamingöverlapp
      </div>
      <div className="px-3 py-2 space-y-2">
        <div>
          <div className="text-xxs text-ink-3 mb-1">Alla har ({intersect.length})</div>
          <ProviderPills ids={intersect} highlight />
        </div>
        <div>
          {/* Räknaren matchar pill-listan (union minus gemensamma) — inte
              hela unionen (G2). Tom diff förklaras ärligt istället för "—". */}
          <div className="text-xxs text-ink-3 mb-1">Bara någon har ({onlySome.length})</div>
          {onlySome.length > 0 ? (
            <ProviderPills ids={onlySome} />
          ) : (
            <div className="text-xxs text-ink-3">
              {union.length > 0 ? 'Alla har samma tjänster.' : 'Inga tjänster angivna ännu.'}
            </div>
          )}
        </div>
        <JustWatchCredit className="block pt-1" />
      </div>
    </div>
  );
}

export function ProviderPills({ ids, highlight = false }: { ids: number[]; highlight?: boolean }) {
  if (ids.length === 0) {
    return <div className="text-xxs text-ink-3">—</div>;
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
              highlight ? 'border-acc-deep text-acc-deep' : 'border-rule text-ink-3'
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

// Plaintext-tokenet finns inte längre på Firestore (bara hash). Vi cachar
// plaintext i localStorage per groupId så ägaren kan återbesöka panel:n och
// kopiera länken igen. På en ny enhet syns inte länken — då måste ägaren
// rotera för att få en ny synlig plaintext.
export function InvitePanel({
  groupId, group, isOwner,
}: {
  groupId: string;
  group: { inviteTokenHash: string | null; inviteTokenRotatedAt?: Date | null };
  isOwner: boolean;
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
  const rotatedAt = group.inviteTokenRotatedAt ?? null;

  const inviteUrl = useMemo(() => {
    if (!tokenIsActive || !cachedPlaintext) return null;
    if (typeof window === 'undefined') return null;
    return `${window.location.origin}/grupper/${groupId}?invite=${cachedPlaintext}`;
  }, [tokenIsActive, cachedPlaintext, groupId]);

  const now = useMountTime(); // number | null
  const ageLabel = now !== null ? inviteTokenAgeLabel(rotatedAt, now) : null;
  const ageDays = now !== null ? inviteTokenAgeDays(rotatedAt, now) : null;
  const isStale = ageDays !== null && ageDays >= STALE_NUDGE_AFTER_DAYS;

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

  const handleRotate = useCallback(async () => {
    setWorking(true);
    try {
      const plaintext = await rotateInviteToken(groupId);
      cacheInviteToken(groupId, plaintext);
      setCachedPlaintext(plaintext);
    } finally {
      setWorking(false);
    }
  }, [groupId]);

  // Lazy auto-rotation: när ägaren öppnar panel:n och länken är äldre än
  // auto-rotate-tröskeln (30 dagar) roterar vi tyst en gång per montering.
  const autoRotatedRef = useRef(false);
  useEffect(() => {
    if (now === null || autoRotatedRef.current || working) return;
    if (shouldAutoRotateInviteToken({ isOwner, tokenIsActive, rotatedAt, now })) {
      autoRotatedRef.current = true;
      void handleRotate();
    }
  }, [now, isOwner, tokenIsActive, rotatedAt, working, handleRotate]);

  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const handleDisable = async () => {
    setWorking(true);
    try {
      await disableInviteToken(groupId);
      clearInviteToken(groupId);
      setCachedPlaintext(null);
    } finally {
      setWorking(false);
      setConfirmingDisable(false);
    }
  };

  return (
    <div className="bg-surface border border-rule rounded-sm">
      <div className="px-3 py-[6px] border-b border-rule-2 text-[10px] uppercase tracking-[0.5px] text-ink-3 font-semibold">
        Inbjudningslänk
      </div>
      <div className="px-3 py-2 space-y-2">
        {inviteUrl ? (
          <>
            <div className="flex gap-1">
              <input
                readOnly
                value={inviteUrl}
                className="flex-1 px-2 py-1 text-xxs border border-rule rounded-sm bg-white truncate"
                onFocus={e => e.currentTarget.select()}
              />
              <button
                onClick={copy}
                className="px-2 py-1 border border-rule rounded-sm text-xxs bg-white cursor-pointer"
                title="Kopiera"
              >
                <Copy size={11} />
              </button>
            </div>
            {copied && <div className="text-xxs text-acc-deep">Kopierad.</div>}
            {isStale && ageLabel && (
              <div className="text-xxs text-amber-700 bg-amber-50 border border-amber-200 rounded-sm px-2 py-1">
                {ageLabel}. Generera en ny om du misstänker att den läckt.
              </div>
            )}
            <div className="flex gap-1">
              <button
                onClick={handleRotate}
                disabled={working}
                className="inline-flex items-center gap-1 px-2 py-1 border border-rule rounded-sm text-xxs bg-white cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={10} /> Generera ny
              </button>
              <button
                onClick={() => setConfirmingDisable(true)}
                disabled={working}
                className="px-2 py-1 border border-rule rounded-sm text-xxs bg-white cursor-pointer disabled:opacity-50"
              >
                Inaktivera
              </button>
            </div>
          </>
        ) : tokenIsActive ? (
          <>
            <p className="text-xxs text-ink-3 leading-relaxed">
              En aktiv inbjudningslänk finns men plaintext-värdet är inte sparat på den
              här enheten — av säkerhetsskäl lagras det bara client-side. Generera en ny
              för att få en synlig länk att kopiera. Den gamla länken slutar då fungera.
            </p>
            <div className="flex gap-1">
              <button
                onClick={handleRotate}
                disabled={working}
                className="inline-flex items-center gap-1 px-2 py-1 border border-rule rounded-sm text-xxs bg-white cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={10} /> Generera ny
              </button>
              <button
                onClick={() => setConfirmingDisable(true)}
                disabled={working}
                className="px-2 py-1 border border-rule rounded-sm text-xxs bg-white cursor-pointer disabled:opacity-50"
              >
                Inaktivera
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xxs text-ink-3">Ingen aktiv inbjudningslänk.</p>
            <button
              onClick={handleRotate}
              disabled={working}
              className="inline-flex items-center gap-1 px-2 py-1 border border-rule rounded-sm text-xxs bg-white cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={10} /> Skapa länk
            </button>
          </>
        )}
      </div>
      {confirmingDisable && (
        <ConfirmDialog
          title="Inaktivera inbjudningslänken?"
          body="Befintliga länkar slutar fungera direkt. Du kan skapa en ny länk när som helst."
          confirmLabel="Inaktivera"
          onConfirm={() => { void handleDisable(); }}
          onCancel={() => setConfirmingDisable(false)}
        />
      )}
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
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="bg-surface border border-rule rounded-sm">
      <div className="px-3 py-2">
        <button
          onClick={() => setConfirming(true)}
          disabled={working}
          className="inline-flex items-center gap-1 text-xs text-danger-ink hover:underline cursor-pointer disabled:opacity-50"
        >
          <LogOut size={11} /> Lämna gruppen
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title="Lämna gruppen?"
          body="Du tas bort från medlemslistan och kan bara komma tillbaka via en ny inbjudan."
          confirmLabel="Lämna gruppen"
          busy={working}
          onConfirm={async () => {
            setWorking(true);
            try {
              await leaveGroup(groupId, myUid);
              onLeft();
            } finally {
              setWorking(false);
              setConfirming(false);
            }
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
