'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { getGroupSessionHistory } from '@/lib/firebase/groups';
import { posterUrl, titleHref } from '@/lib/tmdb/client';
import type { GroupMember } from '@/types';

// "Senaste filmkvällar" — listar avtryck av Tillsammans-sessioner som
// gruppen valt en titel ifrån. Skrivs av host (eller annan medlem) via
// "Den här tar vi"-knappen i match-vyn på en grupp-bunden session.
//
// Datakälla: groups/{groupId}/sessionHistory. 30s staleTime räcker — nya
// pickar är sällsynta.
export function GroupSessionHistoryPanel({
  groupId, members,
}: {
  groupId: string;
  members: GroupMember[];
}) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['group-session-history', groupId],
    queryFn: () => getGroupSessionHistory(groupId, 8),
    staleTime: 30_000,
  });

  if (isLoading || history.length === 0) return null;

  const memberByUid = new Map(members.map(m => [m.uid, m] as const));

  return (
    <div className="bg-surface border border-border-main rounded-sm">
      <div className="px-3 py-[6px] border-b border-border-light text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold">
        Senaste filmkvällar
      </div>
      <ul className="divide-y divide-border-light">
        {history.map(entry => {
          const poster = posterUrl(entry.posterPath, 'w92');
          const href = titleHref(entry.mediaType, entry.pickedTmdbId);
          const initials = entry.participantUids
            .map(uid => memberByUid.get(uid)?.displayName)
            .filter((n): n is string => !!n)
            .map(abbrev);
          return (
            <li key={entry.sessionId} className="px-3 py-[6px] flex items-center gap-2">
              {poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={poster}
                  alt=""
                  className="w-[28px] h-[42px] object-cover rounded-sm shrink-0"
                  loading="lazy"
                  decoding="async"
                  width={28}
                  height={42}
                />
              ) : (
                <div className="w-[28px] h-[42px] bg-border-light rounded-sm shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <Link href={href} className="text-xs font-semibold text-text-primary no-underline hover:text-accent block truncate">
                  {entry.mediaTitle}
                </Link>
                <div className="text-xxs text-text-muted">
                  {fmtDate(entry.pickedAt)}
                  {initials.length > 0 && ` · ${initials.join(' + ')}`}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function abbrev(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function fmtDate(d: Date): string {
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'Idag';
  if (diff < 2 * day) return 'Igår';
  if (diff < 7 * day) return `${Math.floor(diff / day)} dagar sedan`;
  return d.toLocaleDateString('sv-SE');
}
