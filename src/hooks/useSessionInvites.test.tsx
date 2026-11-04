import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { SessionInvite } from '@/lib/sessionInvites';

const decline = vi.hoisted(() => vi.fn());
const open = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ uid: 'anna' as string | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: auth.uid }) }));
vi.mock('@/lib/firebase/sessionInvites', () => ({
  declineSessionInvite: decline,
  openSessionInvite: open,
  listSessionInvites: vi.fn().mockResolvedValue([]),
}));

import { useSessionInviteActions } from './useSessionInvites';

const invite = (id: string) => ({ id, sessionId: `s-${id}` }) as unknown as SessionInvite;
const KEY = ['session-invites', 'anna'];

function wrapper() {
  const client = new QueryClient();
  client.setQueryData(KEY, [invite('a'), invite('b')]);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

const cachedIds = (client: QueryClient) =>
  client.getQueryData<SessionInvite[]>(KEY)?.map(i => i.id);

beforeEach(() => {
  decline.mockReset();
  open.mockReset();
  auth.uid = 'anna';
});

describe('useSessionInviteActions', () => {
  it('decline takes the row out of the cached list', async () => {
    decline.mockResolvedValue(undefined);
    const { client, Wrapper } = wrapper();
    const { result } = renderHook(() => useSessionInviteActions(), { wrapper: Wrapper });
    await act(async () => { await result.current.decline('a'); });
    expect(decline).toHaveBeenCalledWith('anna', 'a');
    expect(cachedIds(client)).toEqual(['b']);
  });

  it('join takes the row out once the session is open', async () => {
    open.mockResolvedValue({ status: 'open', sessionId: 's-a' });
    const { client, Wrapper } = wrapper();
    const { result } = renderHook(() => useSessionInviteActions(), { wrapper: Wrapper });
    let outcome: unknown;
    await act(async () => { outcome = await result.current.join(invite('a')); });
    expect(outcome).toEqual({ status: 'open', sessionId: 's-a' });
    expect(cachedIds(client)).toEqual(['b']);
  });

  it('join keeps the row when the session is gone, so it can show the empty state', async () => {
    open.mockResolvedValue({ status: 'gone' });
    const { client, Wrapper } = wrapper();
    const { result } = renderHook(() => useSessionInviteActions(), { wrapper: Wrapper });
    let outcome: unknown;
    await act(async () => { outcome = await result.current.join(invite('a')); });
    expect(outcome).toEqual({ status: 'gone' });
    expect(cachedIds(client)).toEqual(['a', 'b']);
  });

  it('dismissGone takes the kept row out', async () => {
    const { client, Wrapper } = wrapper();
    const { result } = renderHook(() => useSessionInviteActions(), { wrapper: Wrapper });
    act(() => { result.current.dismissGone('a'); });
    expect(cachedIds(client)).toEqual(['b']);
  });

  it('signed out: decline does nothing and join answers gone without a lookup', async () => {
    auth.uid = null;
    const { client, Wrapper } = wrapper();
    const { result } = renderHook(() => useSessionInviteActions(), { wrapper: Wrapper });
    let outcome: unknown;
    await act(async () => {
      await result.current.decline('a');
      outcome = await result.current.join(invite('a'));
    });
    expect(decline).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: 'gone' });
    expect(cachedIds(client)).toEqual(['a', 'b']);
  });
});
