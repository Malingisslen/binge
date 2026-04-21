'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Users, ChevronLeft, Copy, RefreshCw, UserPlus, LogOut, Trash2, Play, Settings, X,
} from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { useGroup } from '@/hooks/useGroups';
import { useGroupMemberProgress } from '@/hooks/useGroupMemberProgress';
import {
  joinGroupViaToken,
  rotateInviteToken,
  disableInviteToken,
  removeMember,
  leaveGroup,
  deleteGroup,
  addMemberByUid,
  updateGroup,
  removeFromGroupWatchlist,
  setMemberRating,
} from '@/lib/firebase/groups';
import { lookupUserByHandle } from '@/lib/firebase/username';
import { createSession, setSessionCandidates } from '@/lib/firebase/sessions';
import { computeSessionProviders, generateCandidates } from '@/lib/together/candidates';
import { storeParticipantId } from '@/hooks/useSession';
import { posterUrl } from '@/lib/tmdb/client';
import { getProvider } from '@/lib/tmdb/providers';
import type {
  AggregationStrategy,
  Group,
  GroupDefaults,
  GroupMember,
  GroupWatchlistItem,
  ProviderMode,
  SessionConfig,
  SessionMediaType,
} from '@/types';

export default function GroupPageClient({ id }: { id: string }) {
  return <AuthGuard><GroupContent id={id} /></AuthGuard>;
}

function GroupContent({ id }: { id: string }) {
  const { user, uid } = useAuth();
  const { group, members, watchlist, loading, notFound } = useGroup(id);
  const searchParams = useSearchParams();
  const inviteParam = searchParams.get('invite');

  const isMember = !!(uid && group?.memberUids.includes(uid));
  const isOwner = !!(uid && group?.ownerUid === uid);

  // Auto-join via invite link
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  useEffect(() => {
    if (!inviteParam || !uid || !user || !group || isMember || joining) return;
    setJoining(true);
    joinGroupViaToken({
      groupId: id,
      token: inviteParam,
      uid,
      displayName: user.displayName,
      username: user.username,
      photoURL: user.photoURL,
      providers: user.myProviders,
    }).then(res => {
      if (!res.ok) {
        setJoinError(
          res.reason === 'invalid_token'
            ? 'Inbjudningslänken är ogiltig eller har dragits tillbaka.'
            : res.reason === 'not_found'
              ? 'Gruppen hittades inte.'
              : 'Du är redan medlem.',
        );
      }
    }).catch(() => setJoinError('Kunde inte gå med i gruppen.'))
      .finally(() => setJoining(false));
  }, [inviteParam, uid, user, group, isMember, joining, id]);

  if (loading) {
    return <div className="text-sm text-text-muted py-4">Laddar grupp...</div>;
  }

  if (notFound || !group) {
    return (
      <div className="max-w-[560px]">
        <h1 className="text-[18px] font-bold mb-2">Gruppen hittades inte</h1>
        <p className="text-xs text-text-muted mb-3">Länken kan vara felaktig eller så har gruppen tagits bort.</p>
        <Link href="/grupper" className="inline-block px-3 py-[5px] bg-accent text-white rounded-sm text-xs font-semibold no-underline">
          Mina grupper
        </Link>
      </div>
    );
  }

  if (!isMember) {
    return (
      <div className="max-w-[560px]">
        <h1 className="text-[18px] font-bold mb-2">{group.name}</h1>
        <p className="text-xs text-text-muted mb-3">
          Du är inte medlem i den här gruppen. Be ägaren om en inbjudningslänk.
        </p>
        {joinError && (
          <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-sm mb-3">
            {joinError}
          </div>
        )}
        <Link href="/grupper" className="inline-block px-3 py-[5px] bg-accent text-white rounded-sm text-xs font-semibold no-underline">
          Mina grupper
        </Link>
      </div>
    );
  }

  return (
    <GroupView
      groupId={id}
      group={group}
      members={members}
      watchlist={watchlist}
      myUid={uid!}
      isOwner={isOwner}
    />
  );
}

function GroupView({
  groupId, group, members, watchlist, myUid, isOwner,
}: {
  groupId: string;
  group: Group;
  members: GroupMember[];
  watchlist: GroupWatchlistItem[];
  myUid: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [showSettings, setShowSettings] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intersectProviders = useMemo(
    () => computeSessionProviders(members, 'intersect'),
    [members],
  );
  const unionProviders = useMemo(
    () => computeSessionProviders(members, 'union'),
    [members],
  );

  const startSession = async () => {
    setError(null);
    setStartingSession(true);
    try {
      const config: SessionConfig = {
        providerMode: group.defaults.providerMode,
        aggregation: group.defaults.aggregation,
        mediaType: group.defaults.mediaType,
        maxRuntimeMin: null,
        allowAsymmetry: true,
      };
      const me = members.find(m => m.uid === myUid);
      const sessionId = await createSession({
        hostUid: myUid,
        hostName: group.name,
        hostProviders: me?.providers ?? [],
        config,
      });
      storeParticipantId(sessionId, myUid);
      const seedProviders = config.providerMode === 'intersect' ? intersectProviders : unionProviders;
      const candidates = await generateCandidates({ config, providers: seedProviders });
      await setSessionCandidates(sessionId, candidates);
      router.push(`/tillsammans/${sessionId}`);
    } catch (err) {
      console.error(err);
      setError('Kunde inte starta session.');
      setStartingSession(false);
    }
  };

  return (
    <div className="max-w-[1100px]">
      <Link
        href="/grupper"
        className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary no-underline mb-2"
      >
        <ChevronLeft size={12} /> Mina grupper
      </Link>

      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Users size={18} className="text-accent shrink-0" />
          <h1 className="text-[18px] font-bold text-text-primary truncate">{group.name}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={startSession}
            disabled={startingSession || members.length === 0}
            className="inline-flex items-center gap-1 px-3 py-[5px] bg-accent text-white rounded-sm text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            <Play size={11} />
            {startingSession ? 'Startar...' : 'Starta session'}
          </button>
          {isOwner && (
            <button
              onClick={() => setShowSettings(true)}
              className="inline-flex items-center gap-1 px-3 py-[5px] border border-border-main rounded-sm text-xs bg-white cursor-pointer"
            >
              <Settings size={11} />
              Inställningar
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-sm mb-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
        <div className="space-y-3">
          <MembersPanel
            groupId={groupId}
            members={members}
            ownerUid={group.ownerUid}
            myUid={myUid}
            isOwner={isOwner}
          />
          <ProviderOverlapPanel intersect={intersectProviders} union={unionProviders} />
          {isOwner && <InvitePanel groupId={groupId} group={group} />}
          {!isOwner && <LeavePanel groupId={groupId} myUid={myUid} onLeft={() => router.push('/grupper')} />}
        </div>

        <div>
          <GroupWatchlistTable
            groupId={groupId}
            watchlist={watchlist}
            members={members}
            myUid={myUid}
            isOwner={isOwner}
          />
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          groupId={groupId}
          name={group.name}
          defaults={group.defaults}
          onClose={() => setShowSettings(false)}
          onDelete={() => {
            void deleteGroup(groupId).then(() => router.push('/grupper'));
          }}
        />
      )}
    </div>
  );
}

function MembersPanel({
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
    return <img src={photoURL} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />;
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

function ProviderOverlapPanel({ intersect, union }: { intersect: number[]; union: number[] }) {
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
      </div>
    </div>
  );
}

function ProviderPills({ ids, highlight = false }: { ids: number[]; highlight?: boolean }) {
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

function InvitePanel({
  groupId, group,
}: {
  groupId: string;
  group: { inviteToken: string | null };
}) {
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);
  const inviteUrl = useMemo(() => {
    if (!group.inviteToken) return null;
    if (typeof window === 'undefined') return null;
    return `${window.location.origin}/grupper/${groupId}?invite=${group.inviteToken}`;
  }, [group.inviteToken, groupId]);

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
                className="flex-1 px-2 py-1 text-xxs font-mono border border-border-main rounded-sm bg-white truncate"
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
            {copied && <div className="text-xxs text-accent">Kopierad!</div>}
            <div className="flex gap-1">
              <button
                onClick={async () => {
                  setWorking(true);
                  try { await rotateInviteToken(groupId); } finally { setWorking(false); }
                }}
                disabled={working}
                className="inline-flex items-center gap-1 px-2 py-1 border border-border-main rounded-sm text-xxs bg-white cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={10} /> Generera ny
              </button>
              <button
                onClick={async () => {
                  if (!confirm('Inaktivera inbjudningslänken? Befintliga länkar slutar fungera.')) return;
                  setWorking(true);
                  try { await disableInviteToken(groupId); } finally { setWorking(false); }
                }}
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
              onClick={async () => {
                setWorking(true);
                try { await rotateInviteToken(groupId); } finally { setWorking(false); }
              }}
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

function LeavePanel({
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

function GroupWatchlistTable({
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

  const memberUids = useMemo(() => members.map(m => m.uid), [members]);
  const memberProgress = useGroupMemberProgress(memberUids);

  return (
    <div className="bg-surface border border-border-main rounded-sm">
      <div className="px-3 py-[6px] border-b border-border-light text-[10px] uppercase tracking-[0.5px] text-text-muted font-semibold">
        Gemensam watchlist ({watchlist.length})
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
              const href = item.mediaType === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;
              return (
                <tr key={item.tmdbId} className="border-t border-border-light hover:bg-border-light/30">
                  <td className="px-3 py-[6px]">
                    <div className="flex items-center gap-2">
                      {item.posterPath && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={posterUrl(item.posterPath, 'w92') ?? ''}
                          alt=""
                          className="w-[28px] h-[42px] object-cover rounded-sm shrink-0"
                        />
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
                        onClick={() => {
                          if (confirm(`Ta bort "${item.title}" från gruppens watchlist?`)) {
                            void removeFromGroupWatchlist(groupId, item.tmdbId);
                          }
                        }}
                        className="text-text-muted hover:text-red-600 cursor-pointer"
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
            className="w-full text-xxs text-text-muted hover:text-red-600 mt-1 cursor-pointer"
          >
            Rensa
          </button>
        </div>
      )}
    </div>
  );
}

function SettingsModal({
  groupId, name, defaults, onClose, onDelete,
}: {
  groupId: string;
  name: string;
  defaults: GroupDefaults;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [editName, setEditName] = useState(name);
  const [providerMode, setProviderMode] = useState<ProviderMode>(defaults.providerMode);
  const [aggregation, setAggregation] = useState<AggregationStrategy>(defaults.aggregation);
  const [mediaType, setMediaType] = useState<SessionMediaType>(defaults.mediaType);
  const [saving, setSaving] = useState(false);

  // Close on Escape (keyboard accessibility; onClick on backdrop covers mouse).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    try {
      await updateGroup(groupId, {
        name: editName.trim() || name,
        defaults: { providerMode, aggregation, mediaType },
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
      role="presentation"
    >
      <div
        className="bg-surface border border-border-main rounded-sm max-w-[480px] w-full"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-settings-title"
      >
        <div className="px-3 py-2 border-b border-border-light flex items-center justify-between">
          <h2 id="group-settings-title" className="text-sm font-bold">Gruppinställningar</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng gruppinställningar"
            className="text-text-muted hover:text-text-primary cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-3 py-3 space-y-3">
          <div>
            <label className="block text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold mb-1">Namn</label>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              maxLength={48}
              className="w-full px-2 py-1 text-base border border-border-main rounded-sm bg-white"
            />
          </div>

          <div>
            <label className="block text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold mb-1">Default vad?</label>
            <select
              value={mediaType}
              onChange={e => setMediaType(e.target.value as SessionMediaType)}
              className="w-full px-2 py-1 text-xs border border-border-main rounded-sm bg-white"
            >
              <option value="movie">Bara filmer</option>
              <option value="tv">Bara serier</option>
              <option value="both">Blandat</option>
            </select>
          </div>

          <div>
            <label className="block text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold mb-1">Default provider-läge</label>
            <select
              value={providerMode}
              onChange={e => setProviderMode(e.target.value as ProviderMode)}
              className="w-full px-2 py-1 text-xs border border-border-main rounded-sm bg-white"
            >
              <option value="intersect">Alla har (intersect)</option>
              <option value="union">Någon har (union)</option>
            </select>
          </div>

          <div>
            <label className="block text-xxs uppercase tracking-[0.5px] text-text-muted font-semibold mb-1">Default aggregering</label>
            <select
              value={aggregation}
              onChange={e => setAggregation(e.target.value as AggregationStrategy)}
              className="w-full px-2 py-1 text-xs border border-border-main rounded-sm bg-white"
            >
              <option value="least_misery">Ingen hatar det</option>
              <option value="average">Flest positiva</option>
              <option value="fair">Turordning</option>
            </select>
          </div>
        </div>

        <div className="px-3 py-2 border-t border-border-light flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-[5px] bg-accent text-white rounded-sm text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Sparar...' : 'Spara'}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-[5px] border border-border-main rounded-sm text-xs bg-white cursor-pointer"
          >
            Avbryt
          </button>
          <button
            onClick={() => {
              if (confirm('Radera gruppen permanent? Det går inte att ångra.')) onDelete();
            }}
            className="ml-auto inline-flex items-center gap-1 px-3 py-[5px] border border-red-300 text-red-700 rounded-sm text-xs bg-white cursor-pointer"
          >
            <Trash2 size={11} /> Radera grupp
          </button>
        </div>
      </div>
    </div>
  );
}
