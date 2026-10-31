import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * ADR 0026: roster och "nytt inom 30 dagar" skrivs bara av en medlem som delat under den
 * nya samtyckestexten. Mockat test: det bevisar vad hooken SKRIVER och nar, inte att
 * reglerna godtar payloaden. Klockan ar last sa manadsnyckel och 3-dagarsgransen ar
 * deterministiska.
 */

const hoisted = vi.hoisted(() => ({
  setHouseholdContribution: vi.fn((..._a: unknown[]) => Promise.resolve()),
  deleteHouseholdContribution: vi.fn((..._a: unknown[]) => Promise.resolve()),
  subscribeToGroupHousehold: vi.fn(),
  watchlist: { items: [] as unknown[], loading: false },
}));

vi.mock('@/lib/firebase/groups', () => ({
  setHouseholdContribution: hoisted.setHouseholdContribution,
  deleteHouseholdContribution: hoisted.deleteHouseholdContribution,
  subscribeToGroupHousehold: hoisted.subscribeToGroupHousehold,
}));

// Stabila referenser: en ny user/items per render skulle bygga om `built` varje gang.
const USER = { myProviders: [] as number[], providerCosts: {}, providerTiers: {}, providerCampaigns: {} };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'me', user: USER }) }));
vi.mock('@/hooks/useWatchlist', () => ({ useWatchlist: () => hoisted.watchlist }));

import { useGroupHousehold } from './useGroupHousehold';
import { householdVoteMonthKey, type HouseholdContribution } from '@/lib/advisor/householdAggregate';

const NOW = new Date('2026-10-31T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH = householdVoteMonthKey(NOW);

let emit: (cs: HouseholdContribution[]) => void;

/** Eget bidrag som matchar vad hooken bygger ur tom watchlist och tom profil. */
function ownContribution(over: Partial<HouseholdContribution> = {}): HouseholdContribution {
  return {
    uid: 'me',
    providerIds: [],
    providerCosts: {},
    providerCampaigns: {},
    activeProviderIds: [],
    updatedAt: NOW.getTime(),
    ...over,
  };
}

function lastPayload(call = 0): Record<string, unknown> {
  return hoisted.setHouseholdContribution.mock.calls[call][2] as Record<string, unknown>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  hoisted.setHouseholdContribution.mockClear();
  hoisted.deleteHouseholdContribution.mockClear();
  hoisted.watchlist = { items: [], loading: false };
  hoisted.subscribeToGroupHousehold.mockReset();
  hoisted.subscribeToGroupHousehold.mockImplementation((_g: string, onNext: (cs: HouseholdContribution[]) => void) => {
    emit = onNext;
    return () => {};
  });
});

afterEach(() => { vi.useRealTimers(); });

function mount() {
  return renderHook(() => useGroupHousehold('g1'));
}

describe('useGroupHousehold — roster kraver ett nytt samtycke (ADR 0026)', () => {
  it('en aldre delare (utan soonProviderIds): setVote skriver ingenting och needsReshare ar true', async () => {
    const { result } = mount();
    act(() => emit([ownContribution()]));

    expect(result.current.status).toBe('active');
    expect(result.current.needsReshare).toBe(true);
    await act(async () => { await result.current.setVote(8, 'ok'); });

    expect(hoisted.setHouseholdContribution).not.toHaveBeenCalled();
  });

  it('en delare med faltet: needsReshare ar false och setVote skriver ETT bidrag med roster + aktuell manad', async () => {
    const { result } = mount();
    act(() => emit([ownContribution({ soonProviderIds: [] })]));

    expect(result.current.needsReshare).toBe(false);
    await act(async () => { await result.current.setVote(8, 'ok'); });

    expect(hoisted.setHouseholdContribution).toHaveBeenCalledTimes(1);
    const [groupId, uid] = hoisted.setHouseholdContribution.mock.calls[0];
    expect([groupId, uid]).toEqual(['g1', 'me']);
    const payload = lastPayload();
    expect(payload.votes).toEqual({ 8: 'ok' });
    expect(payload.votesMonth).toBe(MONTH);
    expect(payload.soonProviderIds).toEqual([]);
  });

  it('tva setVote i rad ger tva skrivningar och den andras payload innehaller BADA rosterna', async () => {
    const { result } = mount();
    act(() => emit([ownContribution({ soonProviderIds: [] })]));

    // Ingen snapshot emitteras mellan dem: den andra rosten maste lasa den forstas skrivning.
    await act(async () => {
      const first = result.current.setVote(8, 'ok');
      const second = result.current.setVote(337, 'keep');
      await Promise.all([first, second]);
    });

    expect(hoisted.setHouseholdContribution).toHaveBeenCalledTimes(2);
    expect(lastPayload(0).votes).toEqual({ 8: 'ok' });
    expect(lastPayload(1).votes).toEqual({ 8: 'ok', 337: 'keep' });
    expect(lastPayload(1).votesMonth).toBe(MONTH);
  });

  it('optIn skriver soonProviderIds, harlett ur watchlisten', async () => {
    hoisted.watchlist = {
      loading: false,
      items: [{ status: 'mina', providers: [8], nextAirDate: '2026-11-05' }],
    };
    const { result } = mount();
    // Matchar det hooken bygger ur raden, sa besoksrefreshen inte skriver ett eget bidrag.
    act(() => emit([ownContribution({ activeProviderIds: [8] })]));
    expect(result.current.ready).toBe(true);

    await act(async () => { await result.current.optIn(); });

    expect(hoisted.setHouseholdContribution).toHaveBeenCalledTimes(1);
    expect(lastPayload().soonProviderIds).toEqual([8]);
  });
});

describe('useGroupHousehold — besoksrefresh', () => {
  it('skriver hogst en gang per besok, aven nar bidraget emitteras igen', () => {
    // Datan ar ogiltig mot watchlisten (ett gammalt kostnadsfalt) sa dirty-checken slar.
    const stale = ownContribution({ soonProviderIds: [], providerIds: [999] });
    mount();
    act(() => emit([stale]));
    act(() => emit([{ ...stale }]));
    act(() => emit([{ ...stale, providerIds: [998] }]));

    expect(hoisted.setHouseholdContribution).toHaveBeenCalledTimes(1);
  });

  it('en soon-flagga aldre an 3 dagar men oforandrad skrivs om vid besok', () => {
    mount();
    act(() => emit([ownContribution({ soonProviderIds: [], updatedAt: NOW.getTime() - 4 * DAY_MS })]));

    expect(hoisted.setHouseholdContribution).toHaveBeenCalledTimes(1);
    expect(lastPayload().soonProviderIds).toEqual([]);
  });

  it('en farsk oforandrad soon-flagga skrivs inte', () => {
    mount();
    act(() => emit([ownContribution({ soonProviderIds: [], updatedAt: NOW.getTime() - 1 * DAY_MS })]));

    expect(hoisted.setHouseholdContribution).not.toHaveBeenCalled();
  });
});
