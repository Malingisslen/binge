import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// BIN-1027 — the third call site of the marked-seen rule, and the only one that renders on
// someone ELSE's profile. Same rule as the stats page, same reason it is the status and not
// the date: `watchedAt` is stamped when a film is marked seen and not cleared when it later
// leaves 'sedd', so a dropped film can carry a date and a seen one can lack it.
//
// What this file adds over `stats/page.test.tsx` is that a wrong count here is public. The
// tile sits on a profile other people read.

// BIN-1211: profilen monterar UgcActionsMenu, vars modulgraf når firebase-konfigen, vars
// top-level getAuth() kastar på testnyckeln.
vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));
// Menyn anropar useBlockedUsers, som prenumererar på Firestore. Mot den stubbade appen
// ovan kastar den initieringen.
vi.mock('@/hooks/useFriends', () => ({ useFriendActions: () => ({ refreshFriendship: vi.fn() }) }));
vi.mock('@/hooks/useBlockedUsers', () => ({
  useBlockedUsers: () => ({ isBlocked: () => false, blockUser: vi.fn(), unblockUser: vi.fn() }),
}));

const watchlist: unknown[] = [];
const PUBLIC_PROFILE = { uid: 'u1', card: { displayName: 'Malin', bio: '', isPublic: true } };
const profile = vi.hoisted(() => ({ data: null as unknown }));
const auth = vi.hoisted(() => ({ uid: 'me' as string | null }));

vi.mock('@/hooks/usePublicProfile', () => ({
  usePublicProfile: () => ({ data: profile.data, isLoading: false }),
  usePublicWatchlist: () => ({ data: watchlist, isLoading: false }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: auth.uid }) }));
vi.mock('@/hooks/useFollow', () => ({
  useFollowerCount: () => ({ data: 0 }),
  useFollowingCount: () => ({ data: 0 }),
}));
vi.mock('@/hooks/useTasteVector', () => ({ useTasteMatch: () => ({ percent: null }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));
vi.mock('@/components/social/FollowButton', () => ({ default: () => null }));
vi.mock('@/components/social/FriendButton', () => ({
  default: ({ targetUid }: { targetUid: string }) => <button>Lägg till vän {targetUid}</button>,
}));
vi.mock('@/components/social/ProfileStatsPanel', () => ({ default: () => null }));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

import UserProfilePageClient from './UserProfilePageClient';

const title = (over: Record<string, unknown>) => ({
  tmdbId: 1,
  mediaType: 'movie',
  status: 'sedd',
  watchedAt: null,
  dropped: false,
  rating: null,
  title: 'En film',
  subscriptionProviders: [],
  ...over,
});

function seenTile(): string {
  const label = screen.getByText('Sedd');
  const card = label.closest('div')?.parentElement ?? label.parentElement!;
  return card.textContent!.replace('Sedd', '').trim();
}

beforeEach(() => {
  watchlist.length = 0;
  profile.data = PUBLIC_PROFILE;
  auth.uid = 'me';
});

describe('Publik profil — the Sedd tile (BIN-1027)', () => {
  it('counts a sedd film that has no watchedAt', () => {
    watchlist.push(title({ tmdbId: 42, watchedAt: null }));

    render(<UserProfilePageClient username="malin" />);

    expect(seenTile()).toBe('1');
  });

  it('does not count a dropped film that still carries a stale date', () => {
    watchlist.push(title({ tmdbId: 43, status: 'avbruten', watchedAt: new Date('2026-08-01') }));

    render(<UserProfilePageClient username="malin" />);

    expect(seenTile()).toBe('0');
  });

  it('control — an ordinary sedd film with a date still counts', () => {
    watchlist.push(title({ tmdbId: 44, watchedAt: new Date('2026-08-02') }));

    render(<UserProfilePageClient username="malin" />);

    expect(seenTile()).toBe('1');
  });
});

// Malin 2026-10-11: a non-public profile was a dead end with no way to send the request
// that would open it. The handle is already public in `usernames/`; nothing else is shown.
describe('Profil som inte är publik', () => {
  beforeEach(() => { profile.data = { uid: 'u-lisa', username: 'lisa', isPrivate: true }; });

  it('visar handtaget och en vänknapp riktad mot rätt konto', () => {
    render(<UserProfilePageClient username="lisa" />);
    expect(screen.getByRole('heading', { name: '@lisa' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lägg till vän u-lisa' })).toBeTruthy();
    expect(screen.queryByText('Sedd')).toBeNull();
  });

  it('ber en utloggad besökare logga in', () => {
    auth.uid = null;
    render(<UserProfilePageClient username="lisa" />);
    expect(screen.getByText('Logga in för att skicka en vänförfrågan.')).toBeTruthy();
  });
});
