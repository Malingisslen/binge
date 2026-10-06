'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import AuthGuard from '@/components/AuthGuard';
import { useSenderProfile } from '@/hooks/useSenderProfile';
import { LoadingView } from '@/components/ui/LoadingView';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import {
  blockedReason,
  inviteAcceptToast,
  inviteBlocksRetry,
  inviteRowNotice,
  inviteStamp,
  type InviteBlock,
} from '@/lib/groupDenialCopy';
import { useMyGroups, useMyGroupInvites } from '@/hooks/useGroups';
import { getPublicGroupName } from '@/lib/firebase/groups';
import type { GroupInvite } from '@/lib/firebase/groups';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { buttonClass, Button } from '@/components/ui/Button';
import { thClass } from '@/components/ui/tableHead';
import { cardClass } from '@/components/ui/Card';

export default function GrupperPage() {
  return <AuthGuard><GrupperList /></AuthGuard>;
}

function GrupperList() {
  const { uid } = useAuth();
  const { groups, loading } = useMyGroups(uid);

  return (
    <div style={{ maxWidth: 820 }}>
      <PendingInvites />
      <header>
        <div className="crumb">Grupper · {groups.length} {groups.length === 1 ? 'grupp' : 'grupper'}</div>
        <h1 className="page-h1">Mina grupper</h1>
        <p className="stand">
          Permanenta konstellationer — slipp bjuda in varje kväll. Bygg en delad
          watchlist, jämför betyg och starta en ny session med ett klick.
        </p>
        {groups.length > 0 && (
          <div className="actions">
            <Link href="/grupper/ny" className={buttonClass()}>
              <Plus size={12} /> Ny grupp
            </Link>
          </div>
        )}
      </header>
      <div style={{ marginTop: 28 }} />

      {loading && <LoadingView label="Laddar grupper…" />}

      {!loading && groups.length === 0 && (
        <div className={cardClass('p-6 text-center')}>
          <p className="text-sm text-ink-2 mb-3">Du är inte med i några grupper än.</p>
          <Link
            href="/grupper/ny"
            className={buttonClass({ variant: 'acc', size: 'sm', className: 'inline-flex items-center gap-1 no-underline' })}
          >
            <Plus size={11} />
            Skapa din första grupp
          </Link>
        </div>
      )}

      {!loading && groups.length > 0 && (
        <div className={cardClass('overflow-hidden')}>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={thClass('text-left px-3')}>Namn</th>
                <th className={thClass('text-left px-3')}>Medlemmar</th>
                <th className={thClass('text-left px-3')}>Tjänster</th>
                <th className={thClass('text-left px-3')}>Roll</th>
                <th className={thClass('text-left px-3')}>Uppdaterad</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.id} className="border-t border-rule-2 hover:bg-rule-2/30">
                  <td className="px-3 py-2">
                    <Link
                      href={`/grupper/${g.id}`}
                      className="text-ink font-semibold no-underline hover:text-acc-deep"
                    >
                      {g.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink-2">{g.memberUids.length}</td>
                  <td className="px-3 py-2 text-ink-3">
                    {g.defaults.providerMode === 'intersect' ? 'Alla har' : 'Någon har'}
                  </td>
                  <td className="px-3 py-2 text-ink-3">
                    {g.ownerUid === uid ? 'Ägare' : 'Medlem'}
                  </td>
                  <td className="px-3 py-2 text-ink-3">
                    {formatRelative(g.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PendingInvites() {
  const { invites, accept, decline } = useMyGroupInvites();
  const { show: toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  // BIN-1166: ett nekande ar DETERMINISTISKT — samma inbjudan ger samma svar varje
  // gang. En toast forsvinner efter nagra sekunder och raden ser darefter orord ut,
  // sa utan det har tillstandet kan man trycka "Acceptera" i all oandlighet pa nagot
  // som aldrig kan lyckas. Tillstandet ar per groupId och overlever toasten.
  //
  // Det bar ORSAKEN, inte en boolean: de tva nekandena har olika atgard. En inbjudan
  // som inte langre haller lagas av en ny inbjudan och av ingenting annat; ett
  // schemanekande kan mycket val ga over vid en omladdning, som hamtar om den profil
  // regeln jamfor mot. En gemensam text hade gett fel rad at det ena av dem — samma
  // felskyllning den har biljetten finns for att ta bort.
  //
  // Och det bar TIDPUNKTEN, for annars ar meningen ovan inte sann i koden.
  // `inviteMemberByUid` skriver om samma dokument-id, sa en agare som bjuder in pa
  // nytt ger raden ett nytt `invitedAt` — men komponenten avmonteras aldrig (den
  // returnerar null nar listan ar tom), sa en spar som bara kandes pa groupId hade
  // last raden for resten av sessionen mot en inbjudan som faktiskt ar giltig.
  const [blocked, setBlocked] = useState<Map<string, InviteBlock>>(new Map());

  if (invites.length === 0) return null;

  const handle = async (invite: GroupInvite, action: 'accept' | 'decline') => {
    const groupId = invite.groupId;
    setBusy(groupId);
    try {
      if (action === 'decline') {
        await decline(groupId);
        return;
      }
      const res = await accept(groupId);
      // Textvalet ligger i `@/lib/groupDenialCopy`, inte har. Det ar hela biljetten,
      // och ett val inbakat i en komponent utan testfil gar att byta tillbaka utan att
      // nagot faller — samma tystnad BIN-1166 finns for att stanga.
      const message = inviteAcceptToast(res);
      if (message) toast(message);
      const reason = inviteBlocksRetry(res);
      if (reason) {
        setBlocked(prev => new Map(prev).set(groupId, { reason, at: inviteStamp(invite) }));
      }
    } catch (e) {
      console.error(e);
      // Grenad pa handlingen: bada vagarna gar genom samma try, sa ett fallerat
      // AVBOJANDE hade annars fatt beskedet om ett accepterande — samma sorts
      // felskyllning den har biljetten finns for att ta bort, en knapp bort.
      toast(action === 'decline'
        ? 'Kunde inte avböja inbjudan just nu. Försök igen om en stund.'
        : 'Kunde inte acceptera inbjudan just nu. Försök igen om en stund.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cardClass('mb-4 overflow-hidden')}>
      <Eyebrow className="px-3 py-[6px] border-b border-rule-2">
        Inbjudningar ({invites.length})
      </Eyebrow>
      <ul className="divide-y divide-rule-2">
        {invites.map(inv => (
          <InviteRow
            key={inv.groupId}
            invite={inv}
            busy={busy === inv.groupId}
            blocked={blockedReason(blocked, inv)}
            onAccept={() => handle(inv, 'accept')}
            onDecline={() => handle(inv, 'decline')}
          />
        ))}
      </ul>
    </div>
  );
}

// Slår upp gruppnamn via groupId och inbjudarens namn via fromUid, och faller
// tillbaka till de denormaliserade fälten på invite-doc:et när uppslaget inte är
// läsbart. Uppslagningen av avsändarnamnet är gatad på synlighet: är avsändaren
// varken publik eller redan vän går profilen inte att läsa och fallbacken går in.
// Därför binder create-regeln fältet i stället (BIN-1127; se `groupInvites` i
// firestore.rules).
function useInviteIdentity(invite: GroupInvite) {
  const groupQuery = useQuery({
    queryKey: ['invite-group-name', invite.groupId],
    queryFn: async () => {
      // BIN-1152: läsningen går mot den publika projektionen, inte mot
      // gruppdokumentet. Gruppdokumentet är låst till medlemmar sedan biljetten,
      // och mottagaren av en inbjudan är per definition inte medlem — den gamla
      // läsningen hade nekats varje gång och alltid fallit tillbaka.
      //
      // Fallbacken på `invite.groupName` nedan står kvar och bär nu mer: en grupp
      // som skapades före biljetten har ingen projektion, och det denormaliserade
      // namnet på inbjudan är då vad som finns kvar att visa. Det är panelens villkor 9 —
      // en saknad projektion får inte visas som ett fel.
      try {
        return await getPublicGroupName(invite.groupId);
      } catch {
        return null;
      }
    },
    enabled: !!invite.groupId,
    staleTime: 60_000,
  });
  // Shared hook — same `['sender-profile', uid]` key + SHAPE as the topbar/friends
  // consumers (a bare-string return here previously collided in the cache).
  const senderQuery = useSenderProfile(invite.fromUid);
  return {
    groupName: groupQuery.data ?? invite.groupName,
    fromDisplayName: senderQuery.data?.displayName ?? invite.fromDisplayName,
  };
}

function InviteRow({
  invite,
  busy,
  blocked,
  onAccept,
  onDecline,
}: {
  invite: GroupInvite;
  busy: boolean;
  blocked: 'invite_invalid' | 'refused' | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { groupName, fromDisplayName } = useInviteIdentity(invite);
  return (
    <li className="px-3 py-2 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-ink truncate">{groupName}</div>
        {inviteRowNotice(blocked)
          ? <div className="text-xxs text-danger-ink truncate">{inviteRowNotice(blocked)}</div>
          : <div className="text-xxs text-ink-3 truncate">{fromDisplayName} bjöd in dig</div>}
      </div>
      <div className="flex gap-1">
        <Button
          onClick={onAccept}
          disabled={busy || blocked !== null}
          variant="acc" size="xs" className="disabled:opacity-60"
        >
          Acceptera
        </Button>
        <Button
          onClick={onDecline}
          disabled={busy}
          variant="ghost" size="xs" className="disabled:opacity-60"
        >
          Avböj
        </Button>
      </div>
    </li>
  );
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just nu';
  if (min < 60) return `${min} min sedan`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h sedan`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} d sedan`;
  return d.toLocaleDateString('sv-SE');
}
