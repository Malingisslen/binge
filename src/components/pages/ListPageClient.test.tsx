// src/components/pages/ListPageClient.test.tsx
//
// BIN-1236. Listsidan är den enda anroparen av listmutationerna som har något att ÅNGRA:
// den patchar React Query-cachen optimistiskt, och sedan mutationerna slutat kasta
// nycklas återställningen på utfallet `{ ok: false }`. Det här testet driver ett nekande
// genom sidans riktiga klickväg och läser CACHEN efteråt — ett test som bara visade att
// mutationen svarar `{ ok: false }` hade varit blint för en sida som slutat läsa svaret.
//
// Mutationerna är mockade här; deras egen fångst och deras besked pinnas i
// `src/hooks/useListMutations.test.tsx`.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { UserList, UserListItem } from '@/types';

vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));

const addItemToList = vi.hoisted(() => vi.fn());
const removeItemFromList = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'owner' }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));
vi.mock('@/components/lists/ListCheapestPlanPanel', () => ({ default: () => null }));
vi.mock('@/lib/firebase/publicProfile', () => ({ getPublicProfileCard: vi.fn() }));
vi.mock('@/hooks/useTMDB', () => ({
  useSearch: () => ({
    data: { results: [{ id: 3, media_type: 'movie', title: 'Tredje', poster_path: null, release_date: '2020-01-01' }] },
    isLoading: false,
  }),
}));
// usePublicList läser samma cachenyckel som sidans patchCache skriver, så det som
// renderas är det cachen håller — precis som i appen.
vi.mock('@/hooks/useLists', () => ({
  usePublicList: (listId: string) =>
    useQuery<UserList | null>({ queryKey: ['public-list', listId], queryFn: async () => null, staleTime: Infinity }),
  useListMutations: () => ({ addItemToList, removeItemFromList }),
  useListEditors: () => ({ addEditor: vi.fn(), removeEditor: vi.fn() }),
  useListFollows: () => ({ isFollowing: () => false, followList: vi.fn(), unfollowList: vi.fn() }),
}));

import ListPageClient from './ListPageClient';

const item = (tmdbId: number, title: string): UserListItem => ({
  tmdbId, mediaType: 'movie', title, posterPath: null, addedAt: new Date(0),
});

function seeded() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const list: UserList = {
    id: 'l1', uid: 'owner', title: 'Min lista', description: '', isPublic: true, editors: [],
    items: [item(1, 'Första'), item(2, 'Andra')],
    createdAt: new Date(0), updatedAt: new Date(0),
  };
  client.setQueryData(['public-list', 'l1'], list);
  render(
    <QueryClientProvider client={client}>
      <ListPageClient listId="l1" />
    </QueryClientProvider>,
  );
  const ids = () => (client.getQueryData<UserList>(['public-list', 'l1'])?.items ?? []).map(i => i.tmdbId);
  return { ids };
}

/** Ett styrbart löfte, så mellanläget går att observera innan utfallet kommer. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe('ListPageClient — den optimistiska patchen återställs på ok:false (BIN-1236)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('en nekad borttagning lägger tillbaka titeln på sin plats', async () => {
    const pending = deferred<{ ok: boolean }>();
    removeItemFromList.mockReturnValueOnce(pending.promise);
    const { ids } = seeded();

    await act(async () => { fireEvent.click(screen.getByLabelText('Ta bort Första från listan')); });
    expect(ids()).toEqual([2]);
    expect(removeItemFromList.mock.calls[0]).toEqual(['l1', 1, { kind: 'removeItemFromList' }]);

    await act(async () => { pending.resolve({ ok: false }); });
    expect(ids()).toEqual([1, 2]);
  });

  it('en lyckad borttagning står kvar', async () => {
    removeItemFromList.mockResolvedValueOnce({ ok: true });
    const { ids } = seeded();

    await act(async () => { fireEvent.click(screen.getByLabelText('Ta bort Första från listan')); });

    expect(ids()).toEqual([2]);
  });

  it('ett nekat tillägg tar bort den optimistiska raden igen', async () => {
    const pending = deferred<{ ok: boolean }>();
    addItemToList.mockReturnValueOnce(pending.promise);
    const { ids } = seeded();

    fireEvent.click(screen.getByText('Lägg till titel'));
    await act(async () => { fireEvent.click(screen.getByText('Tredje')); });
    expect(ids()).toEqual([1, 2, 3]);
    expect(addItemToList.mock.calls[0][2]).toEqual({ kind: 'addItemToList' });

    await act(async () => { pending.resolve({ ok: false }); });
    expect(ids()).toEqual([1, 2]);
  });

  it('ett lyckat tillägg står kvar', async () => {
    addItemToList.mockResolvedValueOnce({ ok: true });
    const { ids } = seeded();

    fireEvent.click(screen.getByText('Lägg till titel'));
    await act(async () => { fireEvent.click(screen.getByText('Tredje')); });

    expect(ids()).toEqual([1, 2, 3]);
  });
});
