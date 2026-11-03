// src/hooks/useNotifications.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// BIN-1170: notis-regeln nekar numera klienten att SKAPA en notis, och en
// `setDoc(..., { merge: true })` mot ett dokument som hunnit raderas utvarderas
// av reglerna som just en CREATE. Hooken maste darfor skriva med `updateDoc`.
//
// Beslutslogiken (vad som rapporteras, att en avvisad rad inte tar de andra med
// sig) provas i useNotifications.helpers.test.ts. Det som provas HAR ar
// kopplingen: vilken Firestore-funktion som faktiskt anropas, mot vilken sokvag,
// med vilken nyttolast. Utan det gar en atergang till `setDoc`+merge igenom
// varje test i bunten.

type DocRef = { path: string };
const updateDoc = vi.hoisted(() => vi.fn<(ref: DocRef, data: unknown) => Promise<void>>(async () => {}));
const setDoc = vi.hoisted(() => vi.fn<(ref: DocRef, data: unknown, options?: unknown) => Promise<void>>(async () => {}));
const writeBatch = vi.hoisted(() => vi.fn());

// Notislistan hooken ser: prenumerationen matas med de har raderna, sa
// `markAllRead` har nagot att ga igenom.
const seeded = vi.hoisted(() => ({ rows: [] as { id: string; read: boolean; kind?: string }[] }));

vi.mock('@/lib/firebase/db', () => ({
  fsdb: async () => ({
    db: {},
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    updateDoc,
    setDoc,
    writeBatch,
  }),
  lazySubscribe: (run: (kit: Record<string, unknown>) => unknown) => {
    run({
      db: {},
      collection: () => ({}),
      query: () => ({}),
      orderBy: () => ({}),
      limit: () => ({}),
      onSnapshot: (_q: unknown, cb: (snap: unknown) => void) => {
        cb({
          docs: seeded.rows.map(row => ({
            id: row.id,
            data: () => ({
              kind: row.kind ?? 'provider_available', tmdbId: 1, mediaType: 'movie', title: 'T',
              read: row.read, createdAt: null,
            }),
          })),
        });
        return () => {};
      },
    });
    return () => {};
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ uid: 'u1', user: null }) }));
// BIN-1345: vanskapsforfragningarna och blockeringarna hooken ser.
const social = vi.hoisted(() => ({
  requests: [] as { fromUid: string; fromDisplayName: string }[],
  blocked: new Set<string>(),
}));
vi.mock('@/hooks/useFriends', () => ({ useFriendRequests: () => ({ data: social.requests }) }));
vi.mock('@/hooks/useBlockedUsers', () => ({
  useBlockedUsers: () => ({ isBlocked: (uid: string) => social.blocked.has(uid) }),
}));
vi.mock('@/lib/firebase/groups', () => ({ getRecentSessionPicksAcrossGroups: vi.fn(async () => []) }));
// Bjud in till Tillsammans: the invites the hook sees.
const invites = vi.hoisted(() => ({ rows: [] as { id: string; fromUid: string }[] }));
vi.mock('@/hooks/useSessionInvites', () => ({ useSessionInvites: () => ({ data: invites.rows }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));

import { useNotifications } from './useNotifications';

beforeEach(() => {
  updateDoc.mockClear();
  setDoc.mockClear();
  writeBatch.mockClear();
  seeded.rows = [];
  social.requests = [];
  social.blocked = new Set();
  invites.rows = [];
});

describe('useNotifications write path (BIN-1170)', () => {
  it('markRead updates the notification instead of merging a new one', async () => {
    const { result } = renderHook(() => useNotifications());

    await act(async () => { await result.current.markRead('n1'); });

    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc).toHaveBeenCalledWith({ path: 'users/u1/notifications/n1' }, { read: true });
    // En merge-skrivning ar en CREATE for reglerna och nekas — den far aldrig
    // aterkomma, och en atomisk bunt tappar alla rader nar en notis ar borta.
    expect(setDoc).not.toHaveBeenCalled();
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it('markRead writes nothing when a write rejects, and does not throw', async () => {
    updateDoc.mockRejectedValueOnce(Object.assign(new Error('not-found'), { code: 'not-found' }));
    const { result } = renderHook(() => useNotifications());

    await act(async () => {
      await expect(result.current.markRead('n1')).resolves.toBeUndefined();
    });
  });

  it('markAllRead writes every unread notification on its own, never as one batch', async () => {
    seeded.rows = [{ id: 'n1', read: false }, { id: 'n2', read: true }, { id: 'n3', read: false }];
    const { result } = renderHook(() => useNotifications());

    await act(async () => { await result.current.markAllRead(); });

    // En atomisk bunt tappar ALLA rader nar en notis hunnit raderas — darfor en
    // skrivning per olast notis, och den redan lasta rors inte.
    expect(writeBatch).not.toHaveBeenCalled();
    expect(updateDoc.mock.calls.map(call => call[0].path)).toEqual([
      'users/u1/notifications/n1',
      'users/u1/notifications/n3',
    ]);
  });

  it('markAllRead still writes the other rows when one write rejects', async () => {
    seeded.rows = [{ id: 'n1', read: false }, { id: 'n2', read: false }, { id: 'n3', read: false }];
    updateDoc.mockImplementation(async (ref: DocRef) => {
      if (ref.path.endsWith('n2')) throw Object.assign(new Error('not-found'), { code: 'not-found' });
    });
    const { result } = renderHook(() => useNotifications());

    await act(async () => {
      await expect(result.current.markAllRead()).resolves.toBeUndefined();
    });

    expect(updateDoc.mock.calls.map(call => call[0].path)).toEqual([
      'users/u1/notifications/n1',
      'users/u1/notifications/n2',
      'users/u1/notifications/n3',
    ]);
    updateDoc.mockReset();
  });
});

describe('useNotifications and blocked people (BIN-1345)', () => {
  it('leaves a request from someone I blocked out of the list and the bell count', () => {
    social.requests = [
      { fromUid: 'anna', fromDisplayName: 'Anna' },
      { fromUid: 'blockad', fromDisplayName: 'Blockad' },
    ];
    social.blocked = new Set(['blockad']);
    const { result } = renderHook(() => useNotifications());

    expect(result.current.friendRequests.map(r => r.fromUid)).toEqual(['anna']);
    expect(result.current.friendRequestsCount).toBe(1);
    expect(result.current.unreadCount).toBe(1);
  });

  it('counts every request when nobody is blocked', () => {
    social.requests = [
      { fromUid: 'anna', fromDisplayName: 'Anna' },
      { fromUid: 'bo', fromDisplayName: 'Bo' },
    ];
    const { result } = renderHook(() => useNotifications());

    expect(result.current.friendRequestsCount).toBe(2);
    expect(result.current.unreadCount).toBe(2);
  });
});

describe('useNotifications and Tillsammans invites', () => {
  it('counts each waiting invite once in the bell, and not its card', () => {
    invites.rows = [{ id: 'S1_anna', fromUid: 'anna' }];
    seeded.rows = [{ id: 'session-invite-e1', read: false, kind: 'session_invite' }, { id: 'n1', read: false }];
    const { result } = renderHook(() => useNotifications());
    expect(result.current.sessionInvitesCount).toBe(1);
    expect(result.current.providerUnreadCount).toBe(1);
    expect(result.current.unreadCount).toBe(2);
    expect(result.current.notifications.find(n => n.id === 'session-invite-e1')?.kind).toBe('session_invite');
  });

  it('leaves an invite from someone I blocked out of the list and the count', () => {
    social.blocked = new Set(['bo']);
    invites.rows = [{ id: 'S1_bo', fromUid: 'bo' }, { id: 'S2_anna', fromUid: 'anna' }];
    const { result } = renderHook(() => useNotifications());
    expect(result.current.sessionInvites.map(i => i.fromUid)).toEqual(['anna']);
    expect(result.current.sessionInvitesCount).toBe(1);
  });
});
