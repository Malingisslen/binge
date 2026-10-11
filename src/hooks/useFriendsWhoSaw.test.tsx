import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({
  friends: [] as { uid: string }[],
  following: [] as string[],
  blocked: new Set<string>(),
  // uid -> watchlist doc data; absent = no readable doc
  docs: {} as Record<string, { status: string; rating?: number | null }>,
  read: [] as string[],
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ uid: 'me' }) }));
vi.mock('@/hooks/useFollow', () => ({ useFollowing: () => ({ followingUids: h.following }) }));
vi.mock('@/hooks/useFriends', () => ({ useFriends: () => ({ data: h.friends }) }));
vi.mock('@/hooks/useBlockedUsers', () => ({ useBlockedUsers: () => ({ blockedUids: h.blocked }) }));
vi.mock('@/lib/firebase/publicProfile', () => ({
  getPublicProfileCard: async (uid: string) => ({ displayName: `Namn ${uid}`, username: uid, photoURL: null }),
}));
vi.mock('@/lib/firebase/db', () => ({
  fsdb: async () => ({
    db: {},
    doc: (_db: unknown, _u: string, uid: string) => ({ uid }),
    getDoc: async ({ uid }: { uid: string }) => {
      h.read.push(uid);
      const d = h.docs[uid];
      return { exists: () => !!d, data: () => d };
    },
  }),
}));

import { useFriendsWhoSaw } from './useFriendsWhoSaw';

function run() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useFriendsWhoSaw('movie', 1), { wrapper });
}

beforeEach(() => {
  h.friends = []; h.following = []; h.blocked = new Set(); h.docs = {}; h.read = [];
});

describe('useFriendsWhoSaw', () => {
  it('tags friends and follows, and lists a friend I also follow once as a friend', async () => {
    h.friends = [{ uid: 'a' }, { uid: 'b' }];
    h.following = ['b', 'c'];
    h.docs = { a: { status: 'sedd' }, b: { status: 'sedd' }, c: { status: 'vill_se' } };
    const { result } = run();
    await waitFor(() => expect(result.current.data).toBeDefined());
    const rel = Object.fromEntries(result.current.data!.map(f => [f.uid, f.relation]));
    expect(rel).toEqual({ a: 'friend', b: 'friend', c: 'following' });
    expect(h.read.filter(u => u === 'b')).toHaveLength(1);
  });

  it('reads friends before follows under the 30-uid cap', async () => {
    h.following = Array.from({ length: 40 }, (_, i) => `f${i}`);
    h.friends = [{ uid: 'friend1' }, { uid: 'friend2' }];
    h.docs = { friend1: { status: 'sedd' }, friend2: { status: 'sedd' } };
    const { result } = run();
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(h.read).toHaveLength(30);
    expect(h.read).toContain('friend1');
    expect(h.read).toContain('friend2');
    expect(result.current.data!.every(f => f.relation === 'friend')).toBe(true);
  });

  it('never reads a blocked friend or blocked follow', async () => {
    h.friends = [{ uid: 'a' }, { uid: 'blockedFriend' }];
    h.following = ['blockedFollow', 'c'];
    h.blocked = new Set(['blockedFriend', 'blockedFollow']);
    h.docs = { a: { status: 'sedd' }, c: { status: 'sedd' } };
    const { result } = run();
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(h.read.sort()).toEqual(['a', 'c']);
  });
});
