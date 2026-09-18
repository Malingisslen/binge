// src/hooks/useListMutations.test.tsx
//
// BIN-1236. Fångsten, rapporten och beskedet för listmutationerna bor i hooken, inte hos
// anroparna — så att en ny anropare som bara gör `await` och struntar i utfallet ändå
// säger till. Det här är testet som pinnar just det: hooken körs på riktigt.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ uid: 'me' }) }));
vi.mock('@/lib/firebase/username', () => ({ lookupUserByHandle: vi.fn() }));

const updateDoc = vi.hoisted(() => vi.fn());
const getDoc = vi.hoisted(() => vi.fn());
const captureError = vi.hoisted(() => vi.fn());
const show = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase/db', () => ({
  fsdb: async () => ({
    db: {},
    doc: (_db: unknown, ...path: string[]) => path.join('/'),
    updateDoc,
    getDoc,
    arrayUnion: (x: unknown) => ({ arrayUnion: x }),
    serverTimestamp: () => 'ts',
  }),
  lazySubscribe: vi.fn(),
}));
vi.mock('@/lib/sentry', () => ({ captureError }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show }) }));

import { useListMutations } from './useLists';

const ITEM = { tmdbId: 42, mediaType: 'movie' as const, title: 'Titeln', posterPath: null };
const denied = () => new Error('permission-denied');

function hook() {
  return renderHook(() => useListMutations()).result;
}

describe('useListMutations — ett nekande säger till och lämnar spår, utan att kasta (BIN-1236)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ items: [{ ...ITEM, addedAt: new Date(0) }] }) });
  });

  it('ett nekat tillägg rapporteras med anroparens kind, säger till och svarar ok:false', async () => {
    updateDoc.mockRejectedValueOnce(denied());
    const result = hook();

    let outcome;
    await act(async () => { outcome = await result.current.addItemToList('l1', ITEM, { kind: 'site-a' }); });

    expect(outcome).toEqual({ ok: false });
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0][1]).toEqual({ scope: 'lists', kind: 'site-a' });
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0]).toBe('Kunde inte lägga till titeln i listan.');
  });

  it('en nekad borttagning rapporteras med sitt eget kind och sin egen text', async () => {
    updateDoc.mockRejectedValueOnce(denied());
    const result = hook();

    let outcome;
    await act(async () => { outcome = await result.current.removeItemFromList('l1', 42, { kind: 'site-b' }); });

    expect(outcome).toEqual({ ok: false });
    expect(captureError.mock.calls[0][1]).toEqual({ scope: 'lists', kind: 'site-b' });
    expect(show.mock.calls[0][0]).toBe('Kunde inte ta bort titeln från listan.');
  });

  it('en läsning som faller före skrivningen fångas på samma sätt', async () => {
    getDoc.mockRejectedValueOnce(denied());
    const result = hook();

    let outcome;
    await act(async () => { outcome = await result.current.removeItemFromList('l1', 42, { kind: 'site-b' }); });

    expect(outcome).toEqual({ ok: false });
    expect(updateDoc).not.toHaveBeenCalled();
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('beskeden namnger ingen orsak klienten inte kan veta', async () => {
    updateDoc.mockRejectedValue(denied());
    const result = hook();
    await act(async () => {
      await result.current.addItemToList('l1', ITEM, { kind: 'a' });
      await result.current.removeItemFromList('l1', 42, { kind: 'b' });
    });
    updateDoc.mockReset();

    expect(show).toHaveBeenCalledTimes(2);
    // Att bara pinna den exakta strängen hade varit uppfyllt av vilken framtida
    // orsaksgissning som helst som råkade läggas till bredvid.
    for (const [message] of show.mock.calls) {
      for (const forbidden of ['tak', 'full', 'behörighet', 'nekad', 'gräns', 'för många']) {
        expect(String(message).toLowerCase()).not.toContain(forbidden);
      }
    }
  });

  it('en lyckad skrivning svarar ok:true och varken rapporterar eller säger till', async () => {
    updateDoc.mockResolvedValue(undefined);
    const result = hook();

    let added, removed;
    await act(async () => {
      added = await result.current.addItemToList('l1', ITEM, { kind: 'a' });
      removed = await result.current.removeItemFromList('l1', 42, { kind: 'b' });
    });

    expect(added).toEqual({ ok: true });
    expect(removed).toEqual({ ok: true });
    expect(updateDoc).toHaveBeenCalledTimes(2);
    expect(captureError).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });
});
