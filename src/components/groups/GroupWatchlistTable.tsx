'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import { posterUrl, titleHref } from '@/lib/tmdb/client';
import { useGroupMemberProgress } from '@/hooks/useGroupMemberProgress';
import { removeFromGroupWatchlist, setMemberRating } from '@/lib/firebase/groups';
import { toneForId } from '@/lib/duotone';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { captureError } from '@/lib/sentry';
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
  // BIN-1308: a refused rating or removal has to say so on its row, instead of the
  // row simply staying as it was.
  // Keyed per row and action, so a write on one row never clears another row's
  // unresolved failure.
  const [failed, setFailed] = useState<Record<string, true>>({});
  const markFailed = (key: string, failedNow: boolean) => {
    setFailed(prev => {
      if (!failedNow && !(key in prev)) return prev;
      const next = { ...prev };
      if (failedNow) next[key] = true;
      else delete next[key];
      return next;
    });
  };

  // BIN-1315, BIN-1330: only the row's latest attempt of an action may set or clear its
  // failure, so an older attempt that is refused late cannot mark a newer, successful
  // one as failed.
  const attempts = useRef<Record<string, number>>({});

  const runAttempt = async (key: string, write: () => Promise<void>, onError: (err: unknown) => void) => {
    const attempt = (attempts.current[key] ?? 0) + 1;
    attempts.current[key] = attempt;
    markFailed(key, false);
    let failedNow = false;
    try {
      await write();
    } catch (err) {
      onError(err);
      failedNow = true;
    }
    if (attempts.current[key] === attempt) markFailed(key, failedNow);
  };

  // BIN-1333: a row that leaves the watchlist takes its failures with it, so a row that
  // is removed and added again does not come back already marked as failed. Only the
  // moment of leaving clears them: Firestore hides a deleted row before the server
  // answers, so a refusal can land while the row is still hidden, and the row then
  // comes back carrying it.
  //
  // BIN-1350: a refusal can also land while the row is hidden and the row never come
  // back, so the title's next add starts with that refusal. A row that returns with a
  // different `addedAt` than it left with is such a new add, and its failures are
  // cleared too. A row Firestore restores after a refusal carries its old `addedAt`, so
  // that refusal still shows.
  const liveRows = useRef<ReadonlyMap<string, number>>(new Map());
  const departedRows = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const live = new Map(watchlist.map(w => [mediaTypeDocId(w.mediaType, w.tmdbId), w.addedAt.getTime()]));
    const stale = new Set<string>();
    for (const [id, addedAt] of liveRows.current) {
      if (live.has(id)) continue;
      stale.add(id);
      departedRows.current.set(id, addedAt);
    }
    for (const [id, addedAt] of live) {
      const departedAddedAt = departedRows.current.get(id);
      if (departedAddedAt === undefined) continue;
      departedRows.current.delete(id);
      if (departedAddedAt !== addedAt) stale.add(id);
    }
    liveRows.current = live;
    if (stale.size > 0) setFailed(prev => dropFailuresFor(prev, stale));
  }, [watchlist]);

  const rate = (item: GroupWatchlistItem, rating: number | null) => runAttempt(
    failureKey('rate', item),
    () => setMemberRating({ groupId, mediaType: item.mediaType, tmdbId: item.tmdbId, uid: myUid, rating }),
    err => {
      console.error('GroupWatchlistTable: rating write failed', err);
      captureError(err, { scope: 'groups', kind: 'groupWatchlistTable-rate' });
    },
  );

  const remove = (item: GroupWatchlistItem) => runAttempt(
    failureKey('remove', item),
    () => removeFromGroupWatchlist(item.mediaType, groupId, item.tmdbId),
    err => {
      console.error('GroupWatchlistTable: removal failed', err);
      captureError(err, { scope: 'groups', kind: 'groupWatchlistTable-remove' });
    },
  );

  return (
    <div className="bg-surface border border-rule rounded-sm">
      <div className="px-3 py-[6px] border-b border-rule-2 text-[10px] uppercase tracking-[0.5px] text-ink-3 font-semibold">
        Gemensamt bibliotek ({watchlist.length})
      </div>

      {sorted.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-ink-3">
          Inga titlar än. Öppna en film eller serie och tryck på <span className="font-semibold">Grupp</span>-knappen för att spara hit.
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-rule-2/40">
              <th className="text-left px-3 py-[6px] text-[10px] uppercase tracking-[0.5px] text-ink-3 font-semibold">Titel</th>
              {members.map(m => (
                <th
                  key={m.uid}
                  className="text-center px-2 py-[6px] text-[10px] uppercase tracking-[0.5px] text-ink-3 font-semibold"
                  title={m.displayName}
                >
                  {abbrev(m.displayName)}
                </th>
              ))}
              <th className="text-right px-3 py-[6px] text-[10px] uppercase tracking-[0.5px] text-ink-3 font-semibold">Snitt</th>
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
              const rowKey = mediaTypeDocId(item.mediaType, item.tmdbId);
              const rateFailed = failed[failureKey('rate', item)] === true;
              const removeFailed = failed[failureKey('remove', item)] === true;
              return (
                <tr key={rowKey} className="border-t border-rule-2 hover:bg-rule-2/30">
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
                          className="text-ink font-semibold no-underline hover:text-acc-deep block truncate"
                        >
                          {item.title}
                        </Link>
                        <div className="text-xxs text-ink-3">
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
                          <>
                            <RatingPicker
                              value={r}
                              onChange={v => { void rate(item, v); }}
                            />
                            {rateFailed && (
                              <div role="alert" className="text-xxs text-danger-ink">Betyget sparades inte</div>
                            )}
                          </>
                        ) : (
                          <span className={r != null ? 'text-ink-2' : 'text-ink-3'}>
                            {r != null ? r : '—'}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-right px-3 py-[6px] text-ink-2">
                    {avg != null ? avg.toFixed(1) : '—'}
                  </td>
                  <td className="text-right px-2 py-[6px]">
                    {canDelete && (
                      <button
                        onClick={() => setItemToRemove(item)}
                        className="text-ink-3 hover:text-danger-ink cursor-pointer"
                        title="Ta bort"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                    {removeFailed && (
                      <div role="alert" className="text-xxs text-danger-ink whitespace-nowrap">Gick inte att ta bort</div>
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
            void remove(itemToRemove);
            setItemToRemove(null);
          }}
          onCancel={() => setItemToRemove(null)}
        />
      )}
    </div>
  );
}

function failureKey(action: 'rate' | 'remove', item: GroupWatchlistItem): string {
  return `${action}:${mediaTypeDocId(item.mediaType, item.tmdbId)}`;
}

function dropFailuresFor(failed: Record<string, true>, rowIds: ReadonlySet<string>): Record<string, true> {
  const stale = Object.keys(failed).filter(key => rowIds.has(key.slice(key.indexOf(':') + 1)));
  if (stale.length === 0) return failed;
  const next = { ...failed };
  for (const key of stale) delete next[key];
  return next;
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
    <div className="text-xxs text-ink-3 mt-[2px] flex flex-wrap gap-[6px]">
      {points.map(p => (
        <span key={p.uid} title={`${p.initial} har sett t.o.m. ${p.code}`}>
          <span className="font-semibold text-ink-2">{p.initial}</span>:{p.code}
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
        className="px-[5px] py-[1px] border border-rule rounded-sm text-xxs bg-white cursor-pointer"
      >
        {value != null ? value : '+'}
      </button>
      {open && (
        <div className="absolute z-10 right-0 mt-[2px] bg-white border border-rule rounded-sm shadow-none flex flex-wrap gap-[2px] p-1 w-[120px]">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
            <button
              key={n}
              onClick={() => { onChange(n); setOpen(false); }}
              className="w-[20px] h-[20px] text-xxs border border-rule-2 rounded-sm hover:border-acc-deep hover:text-acc-deep cursor-pointer bg-white"
            >
              {n}
            </button>
          ))}
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full text-xxs text-ink-3 hover:text-danger-ink mt-1 cursor-pointer"
          >
            Rensa
          </button>
        </div>
      )}
    </div>
  );
}
