'use client';

import { useState } from 'react';
import Link from 'next/link';
import { UserPlus, X } from 'lucide-react';
import { addMemberByUid, removeMember } from '@/lib/firebase/groups';
import { lookupUserByHandle } from '@/lib/firebase/username';
import type { GroupMember } from '@/types';

/**
 * Medlemslistan i en grupp med per-rad delete och "+ Lägg till"-expansion.
 * Delete + add är owner-gated av parent (isOwner-prop).
 */
export function GroupMembersPanel({
  groupId, members, ownerUid, myUid, isOwner,
}: {
  groupId: string;
  members: GroupMember[];
  ownerUid: string;
  myUid: string;
  isOwner: boolean;
}) {
  const [adding, setAdding] = useState(false);
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
        <AddByHandle
          groupId={groupId}
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
                onClick={() => {
                  if (confirm(`Ta bort ${m.displayName} från gruppen?`)) {
                    void removeMember(groupId, m.uid);
                  }
                }}
                className="text-xxs text-text-muted hover:text-red-600 cursor-pointer"
                title="Ta bort"
              >
                <X size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
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

function AddByHandle({
  groupId, existingUids, onDone,
}: {
  groupId: string;
  existingUids: string[];
  onDone: () => void;
}) {
  const [handle, setHandle] = useState('');
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!handle.trim()) return;
    setWorking(true);
    try {
      const target = await lookupUserByHandle(handle);
      if (!target) { setErr('Hittade ingen användare med det @handle:t.'); return; }
      if (existingUids.includes(target.uid)) { setErr('Användaren är redan medlem.'); return; }

      await addMemberByUid({
        groupId,
        uid: target.uid,
        displayName: target.displayName,
        username: target.username,
        photoURL: target.photoURL,
        providers: target.myProviders,
      });
      setHandle('');
      onDone();
    } catch (e2) {
      console.error(e2);
      setErr('Kunde inte lägga till. Användaren kanske inte har en publik profil.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <form onSubmit={submit} className="px-3 py-2 border-b border-border-light bg-white/50 space-y-1">
      <div className="flex gap-1">
        <input
          type="text"
          value={handle}
          onChange={e => setHandle(e.target.value)}
          placeholder="@handle"
          className="flex-1 px-2 py-1 text-xs border border-border-main rounded-sm bg-white"
        />
        <button
          type="submit"
          disabled={working}
          className="px-2 py-1 bg-accent text-white rounded-sm text-xs font-semibold cursor-pointer disabled:opacity-50"
        >
          <UserPlus size={11} />
        </button>
      </div>
      {err && <div className="text-xxs text-red-700">{err}</div>}
    </form>
  );
}
