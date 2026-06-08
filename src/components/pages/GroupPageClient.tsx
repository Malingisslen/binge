'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Users, ChevronLeft, Play, Settings } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { useGroup } from '@/hooks/useGroups';
import { joinGroupViaToken, deleteGroup } from '@/lib/firebase/groups';
import { createSession, setSessionCandidates } from '@/lib/firebase/sessions';
import { computeSessionProviders, generateCandidates } from '@/lib/together/candidates';
import { storeParticipantId } from '@/hooks/useSession';
import { GroupMembersPanel } from '@/components/groups/GroupMembersPanel';
import { GroupWatchlistTable } from '@/components/groups/GroupWatchlistTable';
import { GroupSessionHistoryPanel } from '@/components/groups/GroupSessionHistoryPanel';
import { GroupSettingsModal } from '@/components/groups/GroupSettingsModal';
import {
  InvitePanel,
  LeavePanel,
  ProviderOverlapPanel,
} from '@/components/groups/GroupSidePanels';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingView } from '@/components/ui/LoadingView';
import { NotFound } from '@/components/ui/NotFound';
import type {
  Group,
  GroupMember,
  GroupWatchlistItem,
  SessionConfig,
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
    return <LoadingView variant="detail" label="Laddar grupp…" />;
  }

  if (notFound || !group) {
    return (
      <NotFound
        crumb="Grupp"
        title="Gruppen hittades inte"
        body="Länken kan vara felaktig eller så har gruppen tagits bort."
        action={<Link href="/grupper" className="btn btn-acc btn-sm no-underline">Mina grupper</Link>}
      />
    );
  }

  if (!isMember) {
    return (
      <div>
        <NotFound
          crumb="Grupp"
          title={group.name}
          body="Du är inte medlem i den här gruppen. Be ägaren om en inbjudningslänk."
          action={<Link href="/grupper" className="btn btn-acc btn-sm no-underline">Mina grupper</Link>}
        />
        {joinError && (
          <div className="px-3 py-2 text-xs text-danger-ink bg-danger-soft border border-danger/30 rounded-sm mt-3">
            {joinError}
          </div>
        )}
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
        groupId: group.id,
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
    <div>
      <PageHeader
        crumb={
          <Link href="/grupper" className="inline-flex items-center gap-1 text-ink-3 hover:text-ink-2 no-underline">
            <ChevronLeft size={12} /> Mina grupper
          </Link>
        }
        title={group.name}
        icon={<Users size={20} className="text-accent shrink-0" />}
        actions={
          <>
            <button
              type="button"
              onClick={startSession}
              disabled={startingSession || members.length === 0}
              className="btn btn-acc btn-sm"
            >
              <Play size={11} />
              {startingSession ? 'Startar…' : 'Starta session'}
            </button>
            {isOwner && (
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="btn btn-ghost btn-sm"
              >
                <Settings size={11} />
                Inställningar
              </button>
            )}
          </>
        }
      />

      {error && (
        <div className="px-3 py-2 text-xs text-danger-ink bg-danger-soft border border-danger/30 rounded-sm mb-3 mt-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 mt-3">
        <div className="space-y-3">
          <GroupMembersPanel
            groupId={groupId}
            groupName={group.name}
            members={members}
            ownerUid={group.ownerUid}
            myUid={myUid}
            isOwner={isOwner}
          />
          <ProviderOverlapPanel intersect={intersectProviders} union={unionProviders} />
          {isOwner && <InvitePanel groupId={groupId} group={group} isOwner={isOwner} />}
          {!isOwner && <LeavePanel groupId={groupId} myUid={myUid} onLeft={() => router.push('/grupper')} />}
        </div>

        <div className="space-y-3">
          <GroupWatchlistTable
            groupId={groupId}
            watchlist={watchlist}
            members={members}
            myUid={myUid}
            isOwner={isOwner}
          />
          <GroupSessionHistoryPanel groupId={groupId} members={members} />
        </div>
      </div>

      {showSettings && (
        <GroupSettingsModal
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
