// src/components/title/AddToListButton.test.tsx
//
// BIN-1226, BIN-1236. Vad som pinnas här: titelsidans popover anropar listmutationerna
// med sitt EGET anropsställe. Fångsten, rapporten och beskedet bor sedan BIN-1236 i
// `useListMutations` och pinnas i `src/hooks/useListMutations.test.tsx`; knappen
// mockar hooken, så ett test här av Sentry eller toast hade prövat mocken, inte koden.
//
// Testet driver hela knappens klickväg, inte en utbruten hjälpare: grenen ÄR anropet, och
// en utbrytning hade flyttat det som ska bevisas ifrån det som körs.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import AddToListButton from './AddToListButton';

// Modulgrafen når firebase-konfigen, vars top-level getAuth() kastar på testnyckeln.
// Ingenting på den prövade vägen rör den.
vi.mock('@/lib/firebase/config', () => ({ auth: {}, default: {} }));

const addItemToList = vi.hoisted(() => vi.fn());
const removeItemFromList = vi.hoisted(() => vi.fn());
const lists = vi.hoisted(() => ({ value: [] as Array<{ id: string; title: string; items: Array<{ tmdbId: number }> }> }));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'me' }) }));
vi.mock('@/hooks/useLists', () => ({
  useMyLists: () => ({ lists: lists.value, addItemToList, removeItemFromList }),
}));

const PROPS = { tmdbId: 42, mediaType: 'movie' as const, title: 'Titeln', posterPath: null };

/** Öppna popovern och klicka raden för listan. */
async function clickRow(rowLabel: string) {
  fireEvent.click(screen.getByText('Lista'));
  await act(async () => {
    fireEvent.click(screen.getByText(rowLabel));
  });
}

describe('AddToListButton — anropar mutationerna med sitt eget anropsställe (BIN-1226, BIN-1236)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addItemToList.mockResolvedValue({ ok: true });
    removeItemFromList.mockResolvedValue({ ok: true });
    lists.value = [{ id: 'l1', title: 'Romcoms', items: [] }];
  });

  it('ett tillägg bär kind addItemToList-quickAdd', async () => {
    render(<AddToListButton {...PROPS} />);

    await clickRow('Romcoms');

    expect(addItemToList).toHaveBeenCalledTimes(1);
    expect(addItemToList.mock.calls[0][0]).toBe('l1');
    expect(addItemToList.mock.calls[0][1]).toEqual({ tmdbId: 42, mediaType: 'movie', title: 'Titeln', posterPath: null });
    expect(addItemToList.mock.calls[0][2]).toEqual({ kind: 'addItemToList-quickAdd' });
    expect(removeItemFromList).not.toHaveBeenCalled();
  });

  it('en borttagning bär sitt eget kind, inte tilläggets', async () => {
    lists.value = [{ id: 'l1', title: 'Romcoms', items: [{ tmdbId: 42 }] }];
    render(<AddToListButton {...PROPS} />);

    await clickRow('Romcoms');

    expect(removeItemFromList).toHaveBeenCalledTimes(1);
    expect(removeItemFromList.mock.calls[0]).toEqual(['l1', 42, { kind: 'removeItemFromList-quickAdd' }]);
    expect(addItemToList).not.toHaveBeenCalled();
  });

  it('ett nekat utfall kastar inte ut ur klickhanteraren', async () => {
    // Mutationen kastar aldrig; ett nekande kommer tillbaka som { ok: false }. Knappen har
    // inget att ångra, så det enda som kan gå fel här är att den gör något med utfallet.
    addItemToList.mockResolvedValueOnce({ ok: false });
    render(<AddToListButton {...PROPS} />);

    await clickRow('Romcoms');

    expect(addItemToList).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Romcoms')).toBeTruthy();
  });

  // #14 Software Architects bindande villkor (BIN-1226): de här kind-värdena får inte
  // kollidera med listsidans, annars blir två olika ytor samma rad i Sentry. Källorna läses
  // som text — en jämförelse mellan två importerade konstanter hade inte kunnat se en
  // kollision som uppstår i en strängliteral.
  it('kind-värdena här krockar inte med ListPageClients', () => {
    const kindsIn = (path: string) =>
      [...readFileSync(path, 'utf8').matchAll(/kind:\s*(?:isInList\s*\?\s*)?'([^']+)'(?:\s*:\s*'([^']+)')?/g)]
        .flatMap(m => [m[1], m[2]])
        .filter((k): k is string => Boolean(k));

    const here = kindsIn('src/components/title/AddToListButton.tsx');
    const listPage = kindsIn('src/components/pages/ListPageClient.tsx');

    // Golv före jämförelsen: en regex som slutat matcha ger två tomma mängder, och en
    // tom skärning ser då ut som ett friskt utfall.
    expect(here.length).toBe(2);
    expect(listPage.length).toBe(2);
    expect(here.filter(k => listPage.includes(k))).toEqual([]);
  });
});
