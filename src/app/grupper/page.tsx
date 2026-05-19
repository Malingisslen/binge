'use client';

import Link from 'next/link';
import { Users, Plus } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { useMyGroups } from '@/hooks/useGroups';

export default function GrupperPage() {
  return <AuthGuard><GrupperList /></AuthGuard>;
}

function GrupperList() {
  const { uid } = useAuth();
  const { groups, loading } = useMyGroups(uid);

  return (
    <div style={{ maxWidth: 820 }}>
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

      {loading && <div className="text-sm text-text-muted py-4">Laddar grupper...</div>}

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
