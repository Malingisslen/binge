import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

/**
 * BIN-1152: en NEKAD gruppläsning måste bli en ändlig skärm.
 *
 * Gruppdokumentet är sedan biljetten läsbart bara för medlemmar, så en icke-medlem
 * får permission-denied på prenumerationen i stället för ett dokument.
 * `subscribeToGroup` hade ingen error-callback alls och `lazySubscribe` lägger inte
 * till någon, så `loading` flippade aldrig: det som före biljetten var en ändlig
 * "gruppen hittades inte" hade blivit en evig spinner — sämre än utgångsläget.
 * #26 Informationsarkitektens villkor 1.
 *
 * Testet driver HELA förloppet — nekande → namnuppslag → släppt `loading` — och inte
 * bara slutläget: `loading` får medvetet INTE släppas mellan de två rundturerna, och
 * ett test som bara läser det sista tillståndet kan inte se skillnaden mellan "rätt
 * ordning" och "ingen ordning alls".
 */

const hoisted = vi.hoisted(() => ({
  subscribeToGroup: vi.fn(),
  getPublicGroupName: vi.fn(),
}));

vi.mock('@/lib/firebase/groups', () => ({
  subscribeToGroup: hoisted.subscribeToGroup,
  subscribeToGroupMembers: () => () => {},
  subscribeToGroupWatchlist: () => () => {},
  subscribeToMyGroups: () => () => {},
  subscribeToMyGroupInvites: () => () => {},
  getPublicGroupName: hoisted.getPublicGroupName,
  acceptGroupInvite: vi.fn(),
  declineGroupInvite: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'me', user: null }) }));

import { useGroup } from './useGroups';

/** Callbackarna `subscribeToGroup` fick, så testet kan fyra dem när det vill. */
let callbacks: {
  onDoc: (g: unknown) => void;
  onDenied: () => void;
  onError: () => void;
};

beforeEach(() => {
  hoisted.subscribeToGroup.mockReset();
  hoisted.getPublicGroupName.mockReset();
  hoisted.subscribeToGroup.mockImplementation((
    _id: string,
    onDoc: (g: unknown) => void,
    onDenied: () => void,
    onError: () => void,
  ) => {
    callbacks = { onDoc, onDenied, onError };
    return () => {};
  });
});

describe('useGroup — ett nekande avslutar laddningen (BIN-1152)', () => {
  it('slapper loading forst nar projektionens namn kommit, och bar namnet', async () => {
    // Namnuppslaget hålls medvetet i luften, så mellanläget går att observera.
    let resolveName: (name: string | null) => void = () => {};
    hoisted.getPublicGroupName.mockImplementation(
      () => new Promise<string | null>(res => { resolveName = res; }),
    );

    const { result } = renderHook(() => useGroup('g-1'));
    expect(result.current.loading).toBe(true);

    callbacks.onDenied();

    // MELLANLÄGET: nekandet har landat men namnet inte. `loading` måste stå kvar
    // — annars blinkar "gruppen hittades inte" innan "du är inte medlem i X",
    // eftersom ytan väljer skärm på `publicName`.
    await waitFor(() => expect(result.current.denied).toBe(true));
    expect(result.current.loading).toBe(true);
    expect(result.current.publicName).toBeNull();

    resolveName('Filmkvallarna');

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.publicName).toBe('Filmkvallarna');
    expect(result.current.group).toBeNull();
    // "Finns inte" och "du ar inte medlem" ar TVA skarmar, och det ar `notFound`
    // som skiljer dem fran nekandet.
    expect(result.current.notFound).toBe(false);
  });

  it('slapper loading ocksa nar ingen projektion finns — ingen evig spinner', async () => {
    // En grupp som skapades FORE biljetten har ingen projektion. Utfallet ska vara
    // "hittades inte"-skarmen, aldrig en spinner som aldrig slutar.
    hoisted.getPublicGroupName.mockResolvedValue(null);

    const { result } = renderHook(() => useGroup('g-2'));
    callbacks.onDenied();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.denied).toBe(true);
    expect(result.current.publicName).toBeNull();
  });

  it('slapper loading aven nar namnuppslaget SJALVT kastar', async () => {
    hoisted.getPublicGroupName.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useGroup('g-3'));
    callbacks.onDenied();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.publicName).toBeNull();
  });

  it('ett TRANSIENT fel ar inte ett nekande — det far inte visa en icke-medlemsskarm', async () => {
    const { result } = renderHook(() => useGroup('g-4'));
    callbacks.onError();

    await waitFor(() => expect(result.current.loading).toBe(false));
    // `denied` falskt, sa ytan visar aldrig "du ar inte medlem" for en MEDLEM med
    // dalig uppkoppling. Namnuppslaget gors inte heller.
    expect(result.current.denied).toBe(false);
    expect(result.current.notFound).toBe(true);
    expect(hoisted.getPublicGroupName).not.toHaveBeenCalled();
  });

  it('ett dokument som landar EFTER ett nekande tar tillbaka nekandet', async () => {
    // Rent tillstandsmaskinstest: statet far inte sitta fast i `denied` om ett
    // dokument ANDA kommer. Det bevisar INTE att en riktig lyssnare nagonsin
    // levererar det — en `onSnapshot` som fatt permission-denied ar dod — och det
    // ar vad `resubscribe`-testet nedan finns for.
    hoisted.getPublicGroupName.mockResolvedValue('Filmkvallarna');

    const { result } = renderHook(() => useGroup('g-5'));
    callbacks.onDenied();
    await waitFor(() => expect(result.current.denied).toBe(true));

    callbacks.onDoc({ id: 'g-5', name: 'Filmkvallarna', memberUids: ['me'] });

    await waitFor(() => expect(result.current.denied).toBe(false));
    expect(result.current.loading).toBe(false);
    expect(result.current.group).not.toBeNull();
  });
});

/**
 * BIN-1152, granskningsfynd: en `onSnapshot` som fatt permission-denied ar DOD.
 * Den startar inte om nar reglerna senare slapper igenom samma lasare, och det ar
 * precis vad ett lyckat join gor — skrivningen andrar regelutfallet, inget
 * snapshot-event gor det. Utan en omstart ser den som nyss anvant en fullt giltig
 * inbjudningslank "du ar inte medlem i den har gruppen" tills sidan laddas om.
 *
 * Samma monster och samma skal som `useGroupHousehold` redan har runt opt-in mot
 * share-to-see-reglerna.
 */
describe('useGroup — resubscribe startar om en dod lyssnare (BIN-1152)', () => {
  it('oppnar en NY prenumeration, inte bara nollstaller statet', async () => {
    hoisted.getPublicGroupName.mockResolvedValue('Filmkvallarna');

    const { result } = renderHook(() => useGroup('g-6'));
    await waitFor(() => expect(hoisted.subscribeToGroup).toHaveBeenCalledTimes(1));

    callbacks.onDenied();
    await waitFor(() => expect(result.current.denied).toBe(true));

    act(() => { result.current.resubscribe(); });

    // ETT NYTT ANROP ar pastaendet. Att bara nollstalla `denied` hade lamnat den
    // doda lyssnaren pa plats och skarmen hangande for alltid — statet hade sett
    // friskt ut och ingenting hade levererat ett dokument.
    await waitFor(() => expect(hoisted.subscribeToGroup).toHaveBeenCalledTimes(2));
    expect(result.current.denied).toBe(false);

    // Och den nya prenumerationen levererar, alltsa ar callbackarna omkopplade.
    act(() => { callbacks.onDoc({ id: 'g-6', name: 'Filmkvallarna', memberUids: ['me'] }); });
    await waitFor(() => expect(result.current.group).not.toBeNull());
    expect(result.current.loading).toBe(false);
  });

  it('river den gamla prenumerationen sa tva lyssnare aldrig lever samtidigt', async () => {
    const unsubs: Array<() => void> = [];
    hoisted.subscribeToGroup.mockImplementation((
      _id: string,
      onDoc: (g: unknown) => void,
      onDenied: () => void,
      onError: () => void,
    ) => {
      callbacks = { onDoc, onDenied, onError };
      const unsub = vi.fn();
      unsubs.push(unsub);
      return unsub;
    });

    const { result } = renderHook(() => useGroup('g-7'));
    await waitFor(() => expect(unsubs).toHaveLength(1));

    act(() => { result.current.resubscribe(); });

    await waitFor(() => expect(unsubs).toHaveLength(2));
    // Effektens cleanup maste ha kort for den forsta. En lackt lyssnare skriver
    // vidare till samma state fran ett slutet fonster.
    expect(unsubs[0]).toHaveBeenCalledTimes(1);
    expect(unsubs[1]).not.toHaveBeenCalled();
  });
});
