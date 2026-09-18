// src/components/title/AddToListButton.test.tsx
//
// BIN-1226. Vad som pinnas här: ett NEKAT listanrop från titelsidans popover säger till
// och lämnar ett spår. Före den här bunten anropades mutationerna utan await och utan
// catch, så ett nekande blev en ohanterad rejection — och `firestore.rules` kan sedan
// BIN-1207 neka en liständring på taket.
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
const captureError = vi.hoisted(() => vi.fn());
const show = vi.hoisted(() => vi.fn());
const lists = vi.hoisted(() => ({ value: [] as Array<{ id: string; title: string; items: Array<{ tmdbId: number }> }> }));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'me' }) }));
vi.mock('@/hooks/useLists', () => ({
  useMyLists: () => ({ lists: lists.value, addItemToList, removeItemFromList }),
}));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show }) }));
vi.mock('@/lib/sentry', () => ({ captureError }));

const PROPS = { tmdbId: 42, mediaType: 'movie' as const, title: 'Titeln', posterPath: null };

/** Öppna popovern och klicka raden för listan. */
async function clickRow(rowLabel: string) {
  fireEvent.click(screen.getByText('Lista'));
  await act(async () => {
    fireEvent.click(screen.getByText(rowLabel));
  });
}

describe('AddToListButton — ett nekat anrop säger till och lämnar spår (BIN-1226)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lists.value = [{ id: 'l1', title: 'Romcoms', items: [] }];
  });

  it('ett nekat tillägg rapporteras i scopet lists med anropsställets eget kind', async () => {
    addItemToList.mockRejectedValueOnce(new Error('permission-denied'));
    render(<AddToListButton {...PROPS} />);

    await clickRow('Romcoms');

    expect(addItemToList).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0][1]).toEqual({
      scope: 'lists',
      kind: 'addItemToList-quickAdd',
    });
  });

  it('ett nekat tillägg ger ett besked som inte namnger en orsak', async () => {
    addItemToList.mockRejectedValueOnce(new Error('permission-denied'));
    render(<AddToListButton {...PROPS} />);

    await clickRow('Romcoms');

    expect(show).toHaveBeenCalledTimes(1);
    const message = String(show.mock.calls[0][0]);
    expect(message.length).toBeGreaterThan(0);
    // Orsaksord klienten inte kan veta något om. Att bara pinna den exakta strängen hade
    // varit uppfyllt av vilken framtida orsaksgissning som helst.
    for (const forbidden of ['tak', 'full', 'behörighet', 'nekad', 'gräns', 'för många']) {
      expect(message.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('en nekad borttagning bär sitt eget kind, inte tilläggets', async () => {
    lists.value = [{ id: 'l1', title: 'Romcoms', items: [{ tmdbId: 42 }] }];
    removeItemFromList.mockRejectedValueOnce(new Error('permission-denied'));
    render(<AddToListButton {...PROPS} />);

    await clickRow('Romcoms');

    expect(removeItemFromList).toHaveBeenCalledTimes(1);
    expect(addItemToList).not.toHaveBeenCalled();
    expect(captureError.mock.calls[0][1]).toEqual({
      scope: 'lists',
      kind: 'removeItemFromList-quickAdd',
    });
  });

  it('en lyckad skrivning varken rapporterar eller säger till', async () => {
    addItemToList.mockResolvedValueOnce(undefined);
    render(<AddToListButton {...PROPS} />);

    await clickRow('Romcoms');

    expect(captureError).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  // #14 Software Architects bindande villkor: de här kind-värdena får inte kollidera med
  // listsidans, annars blir två olika ytor samma rad i Sentry. Källorna läses som text —
  // en jämförelse mellan två importerade konstanter hade inte kunnat se en kollision som
  // uppstår i en strängliteral.
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
