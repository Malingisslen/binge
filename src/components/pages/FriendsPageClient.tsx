'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { useFollowList, type FollowListUser } from '@/hooks/useFollowList';
import { useFollowing } from '@/hooks/useFollow';
import { useAuth } from '@/hooks/useAuth';

type Tab = 'following' | 'followers';

export default function FriendsPageClient() {
  const { following, followers, isLoading } = useFollowList();
  const [tab, setTab] = useState<Tab>('following');

  const list = tab === 'following' ? following : followers;
  const empty = !isLoading && list.length === 0;

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-[18px] font-bold text-text-primary">Vänner</h1>
        <p className="text-xs text-text-muted">
          Hitta personer att följa via sökrutan i sidofältet — eller dela din profillänk.
        </p>
      </div>

      <div className="flex border-b border-border-main mb-3">
        <TabButton active={tab === 'following'} onClick={() => setTab('following')}>
          Följer ({following.length})
        </TabButton>
        <TabButton active={tab === 'followers'} onClick={() => setTab('followers')}>
          Följare ({followers.length})
        </TabButton>
      </div>

      {isLoading && <div className="text-sm text-text-muted py-4">Laddar...</div>}

      {empty && tab === 'following' && (
        <EmptyState
          headline="Du följer ingen än"
          body="Hitta andra användare via sökrutan i sidofältet — skriv minst två tecken så dyker användare upp ovanför titlar."
        />
      )}
      {empty && tab === 'followers' && (
        <EmptyState
          headline="Inga följare än"
          body="När någon börjar följa dig dyker de upp här."
        />
      )}

      {!empty && (
        <ul className="bg-surface border border-border-main rounded-sm divide-y divide-border-light">
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
          ? 'border-accent text-accent font-semibold'
          : 'border-transparent text-text-muted hover:text-text-primary'
      }`}
    >
      {children}
    </button>
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
          <Link href={profileLink} className="text-xs font-semibold text-text-primary no-underline hover:text-accent truncate block">
            {user.displayName}
          </Link>
        ) : (
          <div className="text-xs font-semibold text-text-muted truncate">{user.displayName}</div>
        )}
        {user.username && <div className="text-xxs text-text-muted">@{user.username}</div>}
      </div>
      {!isMe && (
        <button
          onClick={() => iAmFollowing ? unfollowUser(user.uid) : followUser(user.uid)}
          className={`px-2 py-[2px] text-xxs border rounded-sm cursor-pointer font-[inherit] ${
            iAmFollowing
              ? 'bg-surface text-text-secondary border-border-main hover:bg-surface-hover'
              : 'bg-accent text-white border-accent'
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
    <div className="bg-surface border border-border-main rounded-sm px-4 py-6 text-center">
      <Search size={18} className="mx-auto text-text-muted mb-2" />
      <div className="text-sm font-semibold text-text-primary mb-1">{headline}</div>
      <p className="text-xs text-text-muted leading-relaxed">{body}</p>
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
    <div className="w-7 h-7 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-semibold shrink-0">
      {initial}
    </div>
  );
}
