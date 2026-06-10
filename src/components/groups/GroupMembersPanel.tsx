'use client';

import { useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { inviteMemberByUid, removeMember } from '@/lib/firebase/groups';
import { useUserSearch } from '@/hooks/useUserSearch';
import { useAuth } from '@/hooks/useAuth';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { ResolvedUser } from '@/lib/firebase/username';
import type { GroupMember } from '@/types';

/**
 * Medlemslistan i en grupp med per-rad delete och "+ Lägg till"-expansion.
 * Delete + add är owner-gated av parent (isOwner-prop).
 */
export function GroupMembersPanel({
  groupId, groupName, members, ownerUid, myUid, isOwner,
}: {
  groupId: string;
  groupName: string;
  members: GroupMember[];
  ownerUid: string;
  myUid: string;
  isOwner: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<GroupMember | null>(null);
  return (
    <div className="bg-surface border border-border-main rounded-sm">
      <div className="px-3 py-[6px] border-b border-border-light flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold">
          Medlemmar ({members.length})
        </div>
        {isOwner && (
          <button
            onClick={() => setAdding(v => !v)}
            className="text-xxs text-accent hover:underline cursor-pointer"
          >
            {adding ? 'Stäng' : '+ Lägg till'}
          </button>
        )}
      </div>
      {adding && isOwner && (
        <AddMemberSearch
          groupId={groupId}
          groupName={groupName}
          existingUids={members.map(m => m.uid)}
          onDone={() => setAdding(false)}
        />
      )}
      <ul className="divide-y divide-border-light">
        {members.map(m => (
          <li key={m.uid} className="px-3 py-2 flex items-center gap-2">
            <Avatar name={m.displayName} photoURL={m.photoURL} />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text-primary truncate">
                {m.username
                  ? <Link href={`/user/${m.username}`} className="no-underline text-text-primary hover:text-accent">{m.displayName}</Link>
                  : m.displayName}
                {m.uid === myUid && <span className="text-xxs text-text-muted ml-1">(du)</span>}
              </div>
              <div className="text-xxs text-text-muted">
                {m.uid === ownerUid ? 'Ägare' : 'Medlem'} · {m.providers.length} tjänster
              </div>
            </div>
            {isOwner && m.uid !== ownerUid && (
              <button
                onClick={() => setMemberToRemove(m)}
                className="text-xxs text-text-muted hover:text-danger-ink cursor-pointer"
                title="Ta bort"
              >
                <X size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {memberToRemove && (
        <ConfirmDialog
          title="Ta bort medlem?"
          body={`${memberToRemove.displayName} tas bort från gruppen och kan bara komma tillbaka via en ny inbjudan.`}
          confirmLabel="Ta bort"
          onConfirm={() => {
            void removeMember(groupId, memberToRemove.uid);
            setMemberToRemove(null);
          }}
          onCancel={() => setMemberToRemove(null)}
        />
      )}
    </div>
  );
}

function Avatar({ name, photoURL }: { name: string; photoURL: string | null }) {
  if (photoURL) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoURL} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" loading="lazy" decoding="async" width={24} height={24} />;
  }
  const initial = (name?.[0] ?? '?').toUpperCase();
  return (
    <div className="w-6 h-6 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-semibold shrink-0">
      {initial}
    </div>
  );
}

// Prefix-sökning för att bjuda in medlem. Skriv minst två tecken — och en
// dropdown med matchande publika användare visas. Klick SKICKAR en inbjudan;
// användaren blir medlem först när hen själv accepterar (samtyckesmodell).
// Listan filtrerar bort befintliga medlemmar och en själv så ägaren inte kan
// råka klicka på fel rad.
function AddMemberSearch({
  groupId, groupName, existingUids,
}: {
  groupId: string;
  groupName: string;
  existingUids: string[];
  onDone: () => void;
}) {
  const { uid: myUid, user } = useAuth();
  const [q, setQ] = useState('');
  const [inviting, setInviting] = useState<string | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const { data: results, isLoading } = useUserSearch(q);

  const filtered = (results ?? []).filter(u => u.uid !== myUid);

  const handleInvite = async (target: ResolvedUser) => {
    if (existingUids.includes(target.uid)) {
      setErr('Användaren är redan medlem.');
      return;
    }
    if (!myUid) return;
    setErr(null);
    setInviting(target.uid);
    try {
      await inviteMemberByUid({
        groupId,
        groupName,
        fromUid: myUid,
        fromDisplayName: user?.displayName ?? 'Någon',
        targetUid: target.uid,
      });
      setInvited(prev => new Set(prev).add(target.uid));
    } catch (e) {
      console.error(e);
      setErr('Kunde inte skicka inbjudan.');
    } finally {
      setInviting(null);
    }
  };

  return (
    <div className="px-3 py-2 border-b border-border-light bg-white/50 space-y-1">
      <input
        type="text"
        value={q}
        onChange={e => { setQ(e.target.value); setErr(null); }}
        placeholder="Sök efter @användarnamn eller namn…"
        className="w-full px-2 py-1 text-xs border border-border-main rounded-sm bg-white outline-none"
        autoFocus
      />
      {q.trim().length >= 2 && isLoading && (
        <div className="text-xxs text-text-muted">Söker…</div>
      )}
      {q.trim().length >= 2 && !isLoading && filtered.length === 0 && (
        <div className="text-xxs text-text-muted">
          Hittade ingen publik profil som matchar.
        </div>
      )}
      {filtered.length > 0 && (
        <ul className="bg-white border border-border-main rounded-sm divide-y divide-border-light">
          {filtered.map(u => {
            const already = existingUids.includes(u.uid);
            const isInvited = invited.has(u.uid);
            const busy = inviting === u.uid;
            return (
              <li key={u.uid} className="px-2 py-[5px] flex items-center gap-2">
                <SmallAvatar name={u.displayName} photoURL={u.photoURL} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text-primary truncate">{u.displayName}</div>
                  <div className="text-xxs text-text-muted truncate">@{u.username}</div>
                </div>
                <button
                  onClick={() => handleInvite(u)}
                  disabled={already || busy || isInvited}
                  className="px-2 py-[2px] text-xxs border-none rounded-sm cursor-pointer font-[inherit] bg-accent text-white disabled:bg-border-main disabled:text-text-muted disabled:cursor-default"
                >
                  {already ? 'Medlem' : isInvited ? 'Inbjuden' : busy ? 'Bjuder in…' : 'Bjud in'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {err && <div className="text-xxs text-red-700">{err}</div>}
    </div>
  );
}

function SmallAvatar({ name, photoURL }: { name: string; photoURL: string | null }) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        className="w-5 h-5 rounded-full object-cover shrink-0"
        loading="lazy"
        decoding="async"
        width={20}
        height={20}
      />
    );
  }
  return (
    <div className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xxs flex items-center justify-center font-semibold shrink-0">
      {(name?.[0] ?? '?').toUpperCase()}
    </div>
  );
}
