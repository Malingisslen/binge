'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Users, ChevronLeft, Play, Settings } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { useGroup } from '@/hooks/useGroups';
import { joinGroupViaToken, deleteGroup } from '@/lib/firebase/groups';
import { joinAttemptFailed, joinLinkMessage } from '@/lib/groupDenialCopy';
import { createSession, setSessionCandidates } from '@/lib/firebase/sessions';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import {
  computeSessionProviders,
  generateCandidates,
  libraryExclusionIds,
} from '@/lib/together/candidates';
import { storeParticipantId } from '@/hooks/useSession';
import { useWatchlist } from '@/hooks/useWatchlist';
import { GroupMembersPanel } from '@/components/groups/GroupMembersPanel';
import { GroupWatchlistTable } from '@/components/groups/GroupWatchlistTable';
import ListCheapestPlanPanel from '@/components/lists/ListCheapestPlanPanel';
import type { ListPlanItem } from '@/hooks/useListCheapestPlan';
import { GroupSessionHistoryPanel } from '@/components/groups/GroupSessionHistoryPanel';
import {
  InvitePanel,
  LeavePanel,
  ProviderOverlapPanel,
} from '@/components/groups/GroupSidePanels';
import HouseholdPanel from '@/components/groups/HouseholdPanel';
import { PageHeader } from '@/components/layout/PageHeader';
import { usePageMeta } from '@/hooks/usePageMeta';
import { LoadingView } from '@/components/ui/LoadingView';
import { NotFound } from '@/components/ui/NotFound';
import type {
  Group,
  GroupMember,
  GroupWatchlistItem,
  SessionConfig,
} from '@/types';

const GroupSettingsModal = dynamic(
  () => import('@/components/groups/GroupSettingsModal').then(m => m.GroupSettingsModal),
  { ssr: false },
);

// BIN-557: the auto-join effect re-runs every time `joining` flips back to
// false, so a join that keeps throwing (offline, Firestore hiccup) used to
// retry forever — a tight write loop against the Blaze cap. Cap the attempts
// and space them out, reusing queryClient's exponential retryDelay shape.
const MAX_JOIN_ATTEMPTS = 3;
const joinBackoffMs = (attempt: number) => Math.min(1000 * 2 ** attempt, 10_000);

export default function GroupPageClient({ id }: { id: string }) {
  return <AuthGuard><GroupContent id={id} /></AuthGuard>;
}

function GroupContent({ id }: { id: string }) {
  const { user, uid } = useAuth();
  const { group, members, watchlist, loading, notFound, denied, publicName, resubscribe } = useGroup(id);
  // X5: gruppnamnet i dokumenttiteln när det laddats (rör inte indexability —
  // catch-all-shellets noindex-default lämnas orörd).
  usePageMeta({ title: group?.name ?? 'Grupp' });
  const searchParams = useSearchParams();
  const inviteParam = searchParams.get('invite');

  const isMember = !!(uid && group?.memberUids.includes(uid));
  const isOwner = !!(uid && group?.ownerUid === uid);

  // Auto-join via invite link
  const [joinError, setJoinError] = useState<string | null>(null);
  // BIN-1166: skilt fran `joinError`, som ocksa satts for 'Du ar redan medlem' — ett
  // utfall dar den yttre texten om ett misslyckat forsok hade motsagt felrutan under.
  const [joinFailed, setJoinFailed] = useState(false);
  const [joining, setJoining] = useState(false);
  const joinAttemptsRef = useRef(0);
  // En NY inbjudningslänk förtjänar en ny budget. Utan det här ignorerades en
  // färsk, giltig länk tyst om en tidigare (roterad) länk redan bränt försöken
  // — klick på den nya länken är bara en SPA-navigering, komponenten monteras
  // aldrig om, så ref:en satt kvar på MAX.
  useEffect(() => { joinAttemptsRef.current = 0; }, [inviteParam]);
  // BIN-1152: `denied` är med i villkoret, och det är det som håller
  // inbjudningslänken vid liv. Effekten krävde tidigare ett laddat `group`, och
  // sedan gruppdokumentet är låst till medlemmar får en icke-medlem aldrig ett —
  // alltså hade auto-joinet aldrig fyrat för någon som faktiskt behöver det.
  useEffect(() => {
    if (!inviteParam || !uid || !user || joining) return;
    if (!group && !denied) return;
    if (isMember) return;
    if (joinAttemptsRef.current >= MAX_JOIN_ATTEMPTS) return;
    const attempt = joinAttemptsRef.current;
    joinAttemptsRef.current = attempt + 1;
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
      // 'transient' är det ENDA resolved-utfallet som är värt ett omförsök —
      // joinGroupViaToken fångar nätverksfel internt och resolvar, så före
      // 2026-07-20 landade de i den terminala grenen och användaren fick höra
      // att en fullt giltig länk dragits tillbaka.
      const exhausted = joinAttemptsRef.current >= MAX_JOIN_ATTEMPTS;
      // Textvalet ligger i `@/lib/groupDenialCopy`, inte har: valet ar hela BIN-1166,
      // och ett val inbakat i en komponent utan testfil gar att byta tillbaka utan att
      // nagot faller. Ett anrop tacker varje utfall, inte bara det terminala.
      setJoinError(joinLinkMessage(res, exhausted));
      // Sidans EGEN rubrik byter sa fort ett forsok faktiskt fallit, ocksa nar
      // forsoken tagit slut pa ett tillfalligt fel — annars star "Be agaren om en
      // inbjudningslank" kvar ovanfor en ruta som sager at en att ladda om.
      setJoinFailed(joinAttemptFailed(res));
      if (!res.ok && res.reason === 'transient') {
        if (exhausted) { setJoining(false); return; }
        setTimeout(() => setJoining(false), joinBackoffMs(attempt));
        return;
      }
      // Övriga resolved-utfall är terminala: en trasig token förblir trasig och en
      // saknad grupp förblir saknad. Bränn budgeten så effekten inte återfyrar.
      joinAttemptsRef.current = MAX_JOIN_ATTEMPTS;
      setJoining(false);

      // BIN-1152: ett lyckat join måste STARTA OM grupp-prenumerationen. Den här
      // raden stod tidigare som "ett lyckat join behöver bara att
      // grupp-prenumerationen hinner ikapp", och det är struket: sedan
      // gruppdokumentet är låst till medlemmar har lyssnaren redan fått
      // permission-denied, och en `onSnapshot` som fått det är död. Den hinner
      // aldrig ikapp — den startar inte om när reglerna senare släpper igenom
      // samma läsare, vilket är exakt vad det här joinet just gjorde.
      //
      // Utan bumpen ser den som nyss använt en fullt giltig länk skärmen "du är
      // inte medlem i den här gruppen" tills hen laddar om sidan.
      if (res.ok) resubscribe();
    }).catch(() => {
      // Only a THROWN error (network/Firestore) is worth retrying.
      const exhausted = joinAttemptsRef.current >= MAX_JOIN_ATTEMPTS;
      setJoinFailed(true);
      setJoinError(exhausted
        ? 'Kunde inte gå med i gruppen. Ladda om sidan och försök igen.'
        : 'Kunde inte gå med i gruppen. Försöker igen…');
      if (exhausted) { setJoining(false); return; }
      setTimeout(() => setJoining(false), joinBackoffMs(attempt));
    });
  }, [inviteParam, uid, user, group, denied, isMember, joining, id, resubscribe]);

  if (loading) {
    return <LoadingView variant="detail" label="Laddar grupp…" />;
  }

  // BIN-1152: TVÅ skärmar, och de förblir två — panelens villkor 4. Före
  // biljetten svarade gruppdokumentet självt på båda frågorna; nu nekas läsningen
  // för en icke-medlem utan att skilja "finns inte" från "du får inte se den", så
  // det är projektionens namn som skiljer dem. Ett namn betyder att gruppen finns.
  //
  // `denied` utan namn faller AVSIKTLIGT igenom till "hittades inte" nedan: det är
  // svaret för ett felstavat id — det vanliga fallet — och det är också vad en
  // grupp utan projektion (en som skapades före biljetten) får. Att i stället visa
  // "du är inte medlem" för varje gissat id hade bekräftat att id:t existerar,
  // vilket är precis den uppräkning biljetten stänger.
  const nonMemberName = denied ? publicName : (group && !isMember ? group.name : null);
  if (nonMemberName !== null) {
    return (
      <div>
        {/* BIN-1166: den YTTRE texten är den primära på sidan, och "be ägaren om en
            inbjudningslänk" är fel åtgärd när en giltig länk just har använts och
            skrivningen nekades på sak. Den meningen står kvar för den som landar här
            UTAN att ha försökt gå med — det vanliga fallet — och byts när ett
            join-försök faktiskt har fallit. */}
        <NotFound
          crumb="Grupp"
          title={nonMemberName}
          body={joinFailed
            ? 'Du är inte medlem i den här gruppen, och försöket att gå med gick inte igenom.'
            : 'Du är inte medlem i den här gruppen. Be ägaren om en inbjudningslänk.'}
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

  if (notFound || denied || !group) {
    return (
      <NotFound
        crumb="Grupp"
        title="Gruppen hittades inte"
        body="Länken kan vara felaktig eller så har gruppen tagits bort."
        action={<Link href="/grupper" className="btn btn-acc btn-sm no-underline">Mina grupper</Link>}
      />
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
  const { items: myLibrary } = useWatchlist();
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

  // BIN-416 — "billigaste sättet att se listan" over the group's shared watchlist,
  // costed against the VIEWING member's own providers. Panel self-gates (≥2 titles).
  const planItems = useMemo<ListPlanItem[]>(
    () => watchlist.map(i => ({ tmdbId: i.tmdbId, mediaType: i.mediaType, title: i.title })),
    [watchlist],
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
        // Sessionsetiketten är gruppnamnet, men deltagar-chippen ska visa
        // personen som startade — inte gruppen (G3).
        hostName: group.name,
        hostDisplayName: me?.displayName ?? 'Värd',
        hostProviders: me?.providers ?? [],
        config,
        groupId: group.id,
      });
      storeParticipantId(sessionId, myUid);
      const seedProviders = config.providerMode === 'intersect' ? intersectProviders : unionProviders;
      // G4: föreslå inte titlar gruppen redan har i gemensamma biblioteket
      // eller som jag själv följer/sett/avbrutit. Övriga medlemmars privata
      // watchlists är inte läsbara klient-sidigt (Firestore-rules) — gruppens
      // watchlist är proxyn för "det vi redan känner till tillsammans".
      const excludeTmdbIds = libraryExclusionIds(myLibrary);
      for (const item of watchlist) excludeTmdbIds.add(mediaTypeDocId(item.mediaType, item.tmdbId));
      const candidates = await generateCandidates({ config, providers: seedProviders, excludeTmdbIds });
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
        icon={<Users size={20} className="text-acc-deep shrink-0" />}
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
          {/* BIN-184: opt-in hushållsvy — aggregatet av delade kostnadsdata. */}
          <HouseholdPanel groupId={groupId} />
          {isOwner && <InvitePanel groupId={groupId} group={group} isOwner={isOwner} />}
          {!isOwner && <LeavePanel groupId={groupId} myUid={myUid} onLeft={() => router.push('/grupper')} />}
        </div>

        <div className="space-y-3">
          <ListCheapestPlanPanel items={planItems} />
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
            void deleteGroup(groupId, myUid).then(() => router.push('/grupper'));
          }}
        />
      )}
    </div>
  );
}
