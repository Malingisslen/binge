import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const send = vi.hoisted(() => vi.fn());
const dismiss = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'anna' }) }));
vi.mock('@/lib/firebase/tips', () => ({
  sendTip: send, dismissTip: dismiss, listTips: vi.fn().mockResolvedValue([]),
}));

import { useTipActions } from './useTips';

function wrapper() {
  const client = new QueryClient();
  client.setQueryData(['tips', 'anna'], [{ id: 'a' }, { id: 'b' }]);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

beforeEach(() => { send.mockReset(); dismiss.mockReset(); });

describe('useTipActions', () => {
  it('sends with the signed-in uid as the sender, whatever the caller passes', async () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useTipActions(), { wrapper: Wrapper });
    await act(async () => { await result.current.sendTip('bea', { mediaType: 'movie', tmdbId: 603, title: 'The Matrix' }, 'Se den!'); });
    expect(send).toHaveBeenCalledWith('bea', { fromUid: 'anna', mediaType: 'movie', tmdbId: 603, title: 'The Matrix', note: 'Se den!' });
  });

  it('removes a dismissed tip from the cached list', async () => {
    const { client, Wrapper } = wrapper();
    dismiss.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTipActions(), { wrapper: Wrapper });
    await act(async () => { await result.current.dismissTip('a'); });
    expect(dismiss).toHaveBeenCalledWith('anna', 'a');
    expect(client.getQueryData<{ id: string }[]>(['tips', 'anna'])).toEqual([{ id: 'b' }]);
  });
});
