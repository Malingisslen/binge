import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { SessionSwipe, TogetherSession } from '@/types';

const auth = vi.hoisted(() => ({ uid: 'host1' as string | null }));
const tracked = vi.hoisted(() => ({ list: [] as Array<{ sessionId: string; participantId: string; joinedAt: number }> }));
const docs = vi.hoisted(() => ({ byId: {} as Record<string, unknown> }));
const listHosted = vi.hoisted(() => vi.fn());
const subscribeSpy = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: auth.uid }) }));
vi.mock('@/hooks/useSession', async () => {
  const timing = await import('@/lib/sessionTiming');
  return {
    getTrackedSessions: () => tracked.list,
    clearStoredParticipantId: vi.fn(),
    isSessionExpired: timing.isSessionExpired,
  };
});
vi.mock('@/lib/firebase/sessions', () => ({
  listHostedSessions: listHosted,
  subscribeToSession: (id: string, cb: (s: unknown) => void) => { subscribeSpy(id); cb(docs.byId[id] ?? null); return () => {}; },
  subscribeToSwipes: (_id: string, cb: (s: SessionSwipe[]) => void) => { cb([]); return () => {}; },
}));

import { useMySessions } from './useMySessions';

const day = 86_400_000;
const session = (id: string, over: Partial<TogetherSession> = {}): TogetherSession => ({
  id, hostUid: 'host1', hostName: 'Malin', groupId: null,
  config: {} as TogetherSession['config'], status: 'active',
  candidates: [{ tmdbId: 1, mediaType: 'movie' }] as TogetherSession['candidates'],
  createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + day),
  ...over,
});

beforeEach(() => {
  auth.uid = 'host1';
  tracked.list = [];
  docs.byId = {};
  subscribeSpy.mockReset();
  listHosted.mockReset();
  listHosted.mockResolvedValue([]);
});

describe('useMySessions', () => {
  it('visar värdens egna sessioner utan lokal spårning, med uid som deltagar-id', async () => {
    const s = session('h1');
    docs.byId.h1 = s;
    listHosted.mockResolvedValue([s]);
    const { result } = renderHook(() => useMySessions());
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(listHosted).toHaveBeenCalledWith('host1');
    expect(result.current[0]).toMatchObject({ sessionId: 'h1', participantId: 'host1', totalCandidates: 1, pendingCount: 1 });
  });

  it('slår ihop med lokalt spårade utan dubbletter och behåller det lokala deltagar-id:t', async () => {
    const s = session('same');
    docs.byId.same = s;
    docs.byId.guest = session('guest', { hostUid: 'other' });
    tracked.list = [
      { sessionId: 'same', participantId: 'p-local', joinedAt: 1 },
      { sessionId: 'guest', participantId: 'p9', joinedAt: 2 },
    ];
    listHosted.mockResolvedValue([s]);
    const { result } = renderHook(() => useMySessions());
    await waitFor(() => expect(listHosted).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current).toHaveLength(2);
    expect(result.current.map(x => x.sessionId).sort()).toEqual(['guest', 'same']);
    expect(result.current.find(x => x.sessionId === 'same')?.participantId).toBe('p-local');
  });

  it('hoppar över värdens avslutade och utgångna sessioner', async () => {
    const done = session('done', { status: 'closed' as TogetherSession['status'] });
    const old = session('old', { expiresAt: new Date(Date.now() - day) });
    docs.byId.done = done;
    docs.byId.old = old;
    listHosted.mockResolvedValue([done, old]);
    const { result } = renderHook(() => useMySessions());
    await waitFor(() => expect(listHosted).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current).toEqual([]);
    expect(subscribeSpy).not.toHaveBeenCalledWith('done');
    expect(subscribeSpy).not.toHaveBeenCalledWith('old');
  });

  it('frågar inte efter värdsessioner när ingen är inloggad', async () => {
    auth.uid = null;
    const { result } = renderHook(() => useMySessions());
    expect(listHosted).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });

  it('klarar att värdfrågan faller och visar de lokala', async () => {
    docs.byId.loc = session('loc');
    tracked.list = [{ sessionId: 'loc', participantId: 'p1', joinedAt: 1 }];
    listHosted.mockRejectedValue(new Error('denied'));
    const { result } = renderHook(() => useMySessions());
    await waitFor(() => expect(result.current).toHaveLength(1));
  });
});
