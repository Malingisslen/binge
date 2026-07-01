'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';
import { useFollowList, type FollowListUser } from '@/hooks/useFollowList';
import { useFollowing } from '@/hooks/useFollow';
import { useFriends, useFriendRequests, useFriendActions } from '@/hooks/useFriends';
import { useAuth } from '@/hooks/useAuth';
import type { FriendRequest, FriendUser } from '@/lib/firebase/friends';
import { PageHeader } from '@/components/layout/PageHeader';
import { usePageMeta } from '@/hooks/usePageMeta';
import { LoadingView } from '@/components/ui/LoadingView';

// Slår upp avsändarens namn/användarnamn via dess uid istället för att lita på
// klient-satta fromDisplayName/fromUsername på request-doc:et (de valideras inte
// regel-sidigt och är därmed förfalskbara). Faller tillbaka till de
// denormaliserade fälten om profilen inte är läsbar (privat profil).
function useSenderProfile(uid: string) {
  return useQuery({
    queryKey: ['sender-profile', uid],
    queryFn: async () => {
      try {
        const { db, doc, getDoc } = await fsdb();
        const snap = await getDoc(doc(db, 'users', uid));
        if (!snap.exists()) return null;
        const d = snap.data();
        return {
          displayName: (d.displayName as string | undefined) ?? null,
          username: (d.username as string | null | undefined) ?? null,
        };
      } catch {
        return null;
      }
    },
    enabled: !!uid,
    staleTime: 60_000,
  });
}

type Tab = 'friends' | 'requests' | 'following' | 'followers';

export default function FriendsPageClient() {
  // X5: 'Vänner' saknade — Binge.nu-suffix i dokumenttiteln.
  usePageMeta({ title: 'Vänner' });
  const { following, followers, isLoading: followLoading } = useFollowList();
  const { data: friends = [], isLoading: friendsLoading } = useFriends();
  const { data: requests = [], isLoading: requestsLoading } = useFriendRequests();
  const [tab, setTab] = useState<Tab>('friends');

  const isLoading = followLoading || friendsLoading || requestsLoading;
  const list = tab === 'following' ? following : tab === 'followers' ? followers : [];
  const empty = !isLoading && (
    (tab === 'friends' && friends.length === 0)
    || (tab === 'requests' && requests.length === 0)
    || (tab === 'following' && following.length === 0)
    || (tab === 'followers' && followers.length === 0)
  );

  return (
    <div>
      <PageHeader
        crumb="Vänner"
        title="Vänner"
        standfirst="Hitta personer att följa via sökfältet i toppraden — eller dela din profillänk."
      />

      <div className="flex border-b border-rule mb-3">
        <TabButton active={tab === 'friends'} onClick={() => setTab('friends')}>
          Vänner ({friends.length})
        </TabButton>
        <TabButton active={tab === 'requests'} onClick={() => setTab('requests')}>
          Förfrågningar ({requests.length})
        </TabButton>
        <TabButton active={tab === 'following'} onClick={() => setTab('following')}>
          Följer ({following.length})
        </TabButton>
        <TabButton active={tab === 'followers'} onClick={() => setTab('followers')}>
          Följare ({followers.length})
        </TabButton>
      </div>

      {isLoading && <LoadingView label="Laddar…" />}

      {empty && tab === 'friends' && (
        <EmptyState
          headline="Inga vänner än"
          body="Vänner ser varandras privata bibliotek. Skicka förfrågan från en användares profil."
        />
      )}
      {empty && tab === 'requests' && (
        <EmptyState
          headline="Inga väntande förfrågningar"
          body="När någon skickar en vänskapsförfrågan dyker den upp här att acceptera eller avböja."
        />
      )}
      {empty && tab === 'following' && (
        <EmptyState
          headline="Du följer ingen än"
          body="Hitta andra användare via sökfältet i toppraden — skriv minst två tecken så dyker användare upp ovanför titlar."
        />
      )}
      {empty && tab === 'followers' && (
        <EmptyState
          headline="Inga följare än"
          body="När någon börjar följa dig dyker de upp här."
        />
      )}

      {!empty && tab === 'friends' && (
        <ul className="bg-surface border border-rule rounded-sm divide-y divide-rule-2">
          {friends.map(f => <FriendRow key={f.uid} friend={f} />)}
        </ul>
      )}

      {!empty && tab === 'requests' && (
        <ul className="bg-surface border border-rule rounded-sm divide-y divide-rule-2">
          {requests.map(r => <RequestRow key={r.fromUid} request={r} />)}
        </ul>
      )}

      {!empty && (tab === 'following' || tab === 'followers') && (
        <ul className="bg-surface border border-rule rounded-sm divide-y divide-rule-2">
          {list.map(u => <Row key={u.uid} user={u} tab={tab} />)}
        </ul>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-[6px] text-xs cursor-pointer border-b-[2px] bg-transparent font-[inherit] ${
        active
          ? 'border-acc-deep text-acc-deep font-semibold'
          : 'border-transparent text-ink-3 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function FriendRow({ friend }: { friend: FriendUser }) {
  const { uid: myUid } = useAuth();
  const { removeFriend } = useFriendActions();
  const isMe = friend.uid === myUid;
  const profileLink = friend.username ? `/user/${friend.username}/` : null;
  return (
    <li className="px-3 py-2 flex items-center gap-2">
      <Avatar name={friend.displayName} photoURL={friend.photoURL} />
      <div className="flex-1 min-w-0">
        {profileLink ? (
          <Link href={profileLink} className="text-xs font-semibold text-ink no-underline hover:text-acc-deep truncate block">
            {friend.displayName}
          </Link>
        ) : (
          <div className="text-xs font-semibold text-ink-3 truncate">{friend.displayName}</div>
        )}
        {friend.username && <div className="text-xxs text-ink-3">@{friend.username}</div>}
      </div>
      {!isMe && (
        <button
          onClick={() => removeFriend(friend.uid)}
          className="px-2 py-[2px] text-xxs border border-rule bg-surface text-ink-2 rounded-sm cursor-pointer font-[inherit] hover:bg-bg-2"
        >
          Ta bort
        </button>
      )}
    </li>
  );
}

function RequestRow({ request }: { request: FriendRequest }) {
  const { acceptFriendRequest, declineFriendRequest } = useFriendActions();
  const { data: sender } = useSenderProfile(request.fromUid);
  // Föredra namn/användarnamn från avsändarens egen profil; fall tillbaka till
  // de denormaliserade request-fälten om profilen inte är läsbar.
  const displayName = sender?.displayName ?? request.fromDisplayName;
  const username = sender?.username ?? request.fromUsername;
  const profileLink = username ? `/user/${username}/` : null;
  return (
    <li className="px-3 py-2 flex items-center gap-2">
      <Avatar name={displayName} photoURL={request.fromPhotoURL} />
      <div className="flex-1 min-w-0">
        {profileLink ? (
          <Link href={profileLink} className="text-xs font-semibold text-ink no-underline hover:text-acc-deep truncate block">
            {displayName}
          </Link>
        ) : (
          <div className="text-xs font-semibold text-ink-3 truncate">{displayName}</div>
        )}
        {username && <div className="text-xxs text-ink-3">@{username}</div>}
      </div>
      <div className="flex gap-1">
        <button
          onClick={() => acceptFriendRequest(request.fromUid)}
          className="px-2 py-[2px] text-xxs border border-acc-deep bg-acc-deep text-white rounded-sm cursor-pointer font-[inherit]"
        >
          Acceptera
        </button>
        <button
          onClick={() => declineFriendRequest(request.fromUid)}
          className="px-2 py-[2px] text-xxs border border-rule bg-surface text-ink-2 rounded-sm cursor-pointer font-[inherit] hover:bg-bg-2"
        >
          Avböj
        </button>
      </div>
    </li>
  );
}

function Row({ user, tab }: { user: FollowListUser; tab: Tab }) {
  const { uid: myUid } = useAuth();
  const { isFollowing, followUser, unfollowUser } = useFollowing();
  const iAmFollowing = isFollowing(user.uid);
  const isMe = user.uid === myUid;

  const profileLink = user.username ? `/user/${user.username}/` : null;

  return (
    <li className="px-3 py-2 flex items-center gap-2">
      <Avatar name={user.displayName} photoURL={user.photoURL} />
      <div className="flex-1 min-w-0">
        {profileLink ? (
          <Link href={profileLink} className="text-xs font-semibold text-ink no-underline hover:text-acc-deep truncate block">
            {user.displayName}
          </Link>
        ) : (
          <div className="text-xs font-semibold text-ink-3 truncate">{user.displayName}</div>
        )}
        {user.username && <div className="text-xxs text-ink-3">@{user.username}</div>}
      </div>
      {!isMe && (
        <button
          onClick={() => iAmFollowing ? unfollowUser(user.uid) : followUser(user.uid)}
          className={`px-2 py-[2px] text-xxs border rounded-sm cursor-pointer font-[inherit] ${
            iAmFollowing
              ? 'bg-surface text-ink-2 border-rule hover:bg-bg-2'
              : 'bg-acc-deep text-white border-acc-deep'
          }`}
        >
          {iAmFollowing
            ? 'Slutar följa'
            : tab === 'followers' ? 'Följ tillbaka' : 'Följ'}
        </button>
      )}
    </li>
  );
}

function EmptyState({ headline, body }: { headline: string; body: string }) {
  return (
    <div className="bg-surface border border-rule rounded-sm px-4 py-6 text-center">
      <Search size={18} className="mx-auto text-ink-3 mb-2" />
      <div className="text-sm font-semibold text-ink mb-1">{headline}</div>
      <p className="text-xs text-ink-3 leading-relaxed">{body}</p>
    </div>
  );
}

function Avatar({ name, photoURL }: { name: string; photoURL: string | null }) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        className="w-7 h-7 rounded-full object-cover shrink-0"
        loading="lazy"
        decoding="async"
        width={28}
        height={28}
      />
    );
  }
  const initial = (name?.[0] ?? '?').toUpperCase();
  return (
    <div className="w-7 h-7 rounded-full bg-acc-deep/20 text-acc-deep text-xs flex items-center justify-center font-semibold shrink-0">
      {initial}
    </div>
  );
}
