'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import { posterUrl, titleHref } from '@/lib/tmdb/client';
import { useGroupMemberProgress } from '@/hooks/useGroupMemberProgress';
import { removeFromGroupWatchlist, setMemberRating } from '@/lib/firebase/groups';
import { toneForId } from '@/lib/duotone';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { GroupMember, GroupWatchlistItem } from '@/types';

/**
 * Gemensam watchlist för en grupp. Varje medlem får en kolumn för sitt
 * betyg; rad-snittet visas längst till höger. TV-serier visar dessutom en
 * "asymmetri-rad" som markerar när medlemmar ligger olika långt i säsongen
 * — pedagogiskt för "åh vänta jag har missat S3" innan session startar.
 *
 * Radering: owner kan ta bort alla items, vanliga medlemmar bara sina egna
 * tillägg (addedBy-check).
 */
export function GroupWatchlistTable({
  groupId, watchlist, members, myUid, isOwner,
}: {
  groupId: string;
  watchlist: GroupWatchlistItem[];
  members: GroupMember[];
  myUid: string;
  isOwner: boolean;
}) {
  const sorted = useMemo(
    () => [...watchlist].sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime()),
    [watchlist],
  );

  const memberProgress = useGroupMemberProgress(groupId);
  const [itemToRemove, setItemToRemove] = useState<GroupWatchlistItem | null>(null);

  return (
    <div className="bg-surface border border-border-main rounded-sm">
      <div className="px-3 py-[6px] border-b border-border-light text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold">
        Gemensamt bibliotek ({watchlist.length})
      </div>

      {sorted.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-text-muted">
          Inga titlar än. Öppna en film eller serie och tryck på <span className="font-semibold">Grupp</span>-knappen för att spara hit.
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-border-light/40">
              <th className="text-left px-3 py-[6px] text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold">Titel</th>
              {members.map(m => (
                <th
                  key={m.uid}
                  className="text-center px-2 py-[6px] text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold"
                  title={m.displayName}
                >
                  {abbrev(m.displayName)}
                </th>
              ))}
              <th className="text-right px-3 py-[6px] text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold">Snitt</th>
              <th className="px-2 py-[6px]"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(item => {
              const ratings = members.map(m => item.memberRatings[m.uid] ?? null);
              const present = ratings.filter((r): r is number => r != null);
              const avg = present.length > 0 ? (present.reduce((a, b) => a + b, 0) / present.length) : null;
              const canDelete = isOwner || item.addedBy === myUid;
              // Skicka groupId i URL:en så title-page kan aktivera spoiler-skydd
              // (Fas 2b) — `?fromGroup={id}` läses av TVShowPageClient.
              const href = titleHref(item.mediaType, item.tmdbId, { fromGroup: groupId });
              return (
                <tr key={item.tmdbId} className="border-t border-border-light hover:bg-border-light/30">
                  <td className="px-3 py-[6px]">
                    <div className="flex items-center gap-2">
                      {item.posterPath && (
                        <div className={`poster duo-${toneForId(item.tmdbId)} w-[28px] h-[42px] shrink-0`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={posterUrl(item.posterPath, 'w92') ?? ''}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            width={28}
                            height={42}
                          />
                        </div>
                      )}
                      <div className="min-w-0">
                        <Link
                          href={href}
                          className="text-text-primary font-semibold no-underline hover:text-accent block truncate"
                        >
                          {item.title}
                        </Link>
                        <div className="text-xxs text-text-muted">
                          {item.mediaType === 'movie' ? 'Film' : 'Serie'}
                          {item.releaseYear ? ` · ${item.releaseYear}` : ''}
                        </div>
                        {item.mediaType === 'tv' && (
                          <TvAsymmetryRow
                            tmdbId={item.tmdbId}
                            members={members}
                            progressByUid={memberProgress}
                          />
                        )}
                      </div>
                    </div>
                  </td>
                  {members.map(m => {
                    const r = item.memberRatings[m.uid] ?? null;
                    const mine = m.uid === myUid;
                    return (
                      <td key={m.uid} className="text-center px-2 py-[6px]">
                        {mine ? (
                          <RatingPicker
                            value={r}
                            onChange={async v => {
                              await setMemberRating({ groupId, tmdbId: item.tmdbId, uid: myUid, rating: v });
                            }}
                          />
                        ) : (
                          <span className={r != null ? 'text-text-secondary' : 'text-text-muted'}>
                            {r != null ? r : '—'}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-right px-3 py-[6px] text-text-secondary">
                    {avg != null ? avg.toFixed(1) : '—'}
                  </td>
                  <td className="text-right px-2 py-[6px]">
                    {canDelete && (
                      <button
                        onClick={() => setItemToRemove(item)}
                        className="text-text-muted hover:text-danger-ink cursor-pointer"
                        title="Ta bort"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {itemToRemove && (
        <ConfirmDialog
          title="Ta bort titel?"
          body={`"${itemToRemove.title}" tas bort från gruppens gemensamma bibliotek, inklusive allas betyg på den.`}
          confirmLabel="Ta bort"
          onConfirm={() => {
            void removeFromGroupWatchlist(groupId, itemToRemove.tmdbId);
            setItemToRemove(null);
          }}
          onCancel={() => setItemToRemove(null)}
        />
      )}
    </div>
  );
}

function abbrev(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function TvAsymmetryRow({
  tmdbId, members, progressByUid,
}: {
  tmdbId: number;
  members: GroupMember[];
  progressByUid: Map<string, Map<number, { lastWatchedSeason: number | null; lastWatchedEpisode: number | null }>>;
}) {
  const points = members
    .map(m => {
      const p = progressByUid.get(m.uid)?.get(tmdbId);
      if (!p || p.lastWatchedSeason == null) return null;
      return {
        uid: m.uid,
        initial: abbrev(m.displayName),
        code: `S${p.lastWatchedSeason}${p.lastWatchedEpisode ? `E${p.lastWatchedEpisode}` : ''}`,
        sortKey: (p.lastWatchedSeason ?? 0) * 1000 + (p.lastWatchedEpisode ?? 0),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (points.length < 2) return null;
  const distinct = new Set(points.map(p => p.code));
  if (distinct.size < 2) return null;

  points.sort((a, b) => b.sortKey - a.sortKey);

  return (
    <div className="text-xxs text-text-muted mt-[2px] flex flex-wrap gap-[6px]">
      {points.map(p => (
        <span key={p.uid} title={`${p.initial} har sett t.o.m. ${p.code}`}>
          <span className="font-semibold text-text-secondary">{p.initial}</span>:{p.code}
        </span>
      ))}
    </div>
  );
}

function RatingPicker({
  value, onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(v => !v)}
        className="px-[5px] py-[1px] border border-border-main rounded-sm text-xxs bg-white cursor-pointer"
      >
        {value != null ? value : '+'}
      </button>
      {open && (
        <div className="absolute z-10 right-0 mt-[2px] bg-white border border-border-main rounded-sm shadow-none flex flex-wrap gap-[2px] p-1 w-[120px]">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
            <button
              key={n}
              onClick={() => { onChange(n); setOpen(false); }}
              className="w-[20px] h-[20px] text-xxs border border-border-light rounded-sm hover:border-accent hover:text-accent cursor-pointer bg-white"
            >
              {n}
            </button>
          ))}
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full text-xxs text-text-muted hover:text-danger-ink mt-1 cursor-pointer"
          >
            Rensa
          </button>
        </div>
      )}
    </div>
  );
}
