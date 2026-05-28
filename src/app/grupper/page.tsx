'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { useMyGroups, useMyGroupInvites } from '@/hooks/useGroups';

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
        <div className="actions">
          <Link href="/grupper/ny" className="btn">
            <Plus size={12} /> Ny grupp
          </Link>
        </div>
      </header>
      <div style={{ marginTop: 28 }} />

      {loading && <div className="text-sm text-text-muted py-4">Laddar grupper…</div>}

      {!loading && groups.length === 0 && (
        <div className="bg-surface border border-border-main rounded-sm p-6 text-center">
          <p className="text-sm text-text-secondary mb-3">Du är inte med i några grupper än.</p>
          <Link
            href="/grupper/ny"
            className="inline-flex items-center gap-1 px-3 py-[5px] bg-accent text-white rounded-sm text-xs font-semibold no-underline"
          >
            <Plus size={11} />
            Skapa din första grupp
          </Link>
        </div>
      )}

      {!loading && groups.length > 0 && (
        <div className="bg-surface border border-border-main rounded-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-border-light/40">
                <th className="text-left px-3 py-[6px] text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold">Namn</th>
                <th className="text-left px-3 py-[6px] text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold">Medlemmar</th>
                <th className="text-left px-3 py-[6px] text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold">Provider-läge</th>
                <th className="text-left px-3 py-[6px] text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold">Roll</th>
                <th className="text-left px-3 py-[6px] text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold">Uppdaterad</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.id} className="border-t border-border-light hover:bg-border-light/30">
                  <td className="px-3 py-2">
                    <Link
                      href={`/grupper/${g.id}`}
                      className="text-text-primary font-semibold no-underline hover:text-accent"
                    >
                      {g.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{g.memberUids.length}</td>
                  <td className="px-3 py-2 text-text-muted">
                    {g.defaults.providerMode === 'intersect' ? 'Alla har' : 'Någon har'}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {g.ownerUid === uid ? 'Ägare' : 'Medlem'}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
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
  const [busy, setBusy] = useState<string | null>(null);

  if (invites.length === 0) return null;

  const handle = async (groupId: string, action: 'accept' | 'decline') => {
    setBusy(groupId);
    try {
      await (action === 'accept' ? accept(groupId) : decline(groupId));
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-surface border border-border-main rounded-sm mb-4 overflow-hidden">
      <div className="px-3 py-[6px] border-b border-border-light text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold">
        Inbjudningar ({invites.length})
      </div>
      <ul className="divide-y divide-border-light">
        {invites.map(inv => (
          <li key={inv.groupId} className="px-3 py-2 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-text-primary truncate">{inv.groupName}</div>
              <div className="text-xxs text-text-muted truncate">{inv.fromDisplayName} bjöd in dig</div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => handle(inv.groupId, 'accept')}
                disabled={busy === inv.groupId}
                className="px-2 py-[2px] text-xxs border border-accent bg-accent text-white rounded-sm cursor-pointer font-[inherit] disabled:opacity-60"
              >
                Acceptera
              </button>
              <button
                onClick={() => handle(inv.groupId, 'decline')}
                disabled={busy === inv.groupId}
                className="px-2 py-[2px] text-xxs border border-border-main bg-surface text-text-secondary rounded-sm cursor-pointer font-[inherit] hover:bg-surface-hover disabled:opacity-60"
              >
                Avböj
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
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
