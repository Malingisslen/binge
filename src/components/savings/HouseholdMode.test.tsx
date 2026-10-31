import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { HouseholdContribution, HouseholdSoonOverview, HouseholdVote } from '@/lib/advisor/householdAggregate';

const NOW = Date.UTC(2026, 9, 31, 12);
const MONTH = '2026-10';

const state = vi.hoisted(() => ({
  status: 'active' as 'loading' | 'gated' | 'active' | 'error',
  contributions: [] as HouseholdContribution[],
  needsReshare: false,
  myVotes: {} as Record<number, HouseholdVote>,
  soon: null as HouseholdSoonOverview | null,
  names: {} as Record<string, string>,
  setVote: vi.fn<(id: number, vote: HouseholdVote | null) => Promise<void>>(() => Promise.resolve()),
  optIn: vi.fn(() => Promise.resolve()),
  optOut: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'u1' }) }));
vi.mock('@/hooks/useMountTime', () => ({ useMountTime: () => NOW }));
vi.mock('@/hooks/useGroupMemberNames', () => ({ useGroupMemberNames: () => state.names }));
vi.mock('@/hooks/useGroupHousehold', () => ({
  useGroupHousehold: () => ({
    status: state.status,
    contributions: state.contributions,
    optIn: state.optIn,
    optOut: state.optOut,
    busy: false,
    ready: true,
    needsReshare: state.needsReshare,
    myVotes: state.myVotes,
    soon: state.soon,
    setVote: state.setVote,
  }),
}));

import HouseholdMode from './HouseholdMode';

// Netflix (8) and Max (384) are real catalogue ids, so the rows get real names.
function contribution(uid: string, over: Partial<HouseholdContribution> = {}): HouseholdContribution {
  return {
    uid,
    providerIds: [8],
    providerCosts: { 8: 169 },
    providerCampaigns: {},
    activeProviderIds: [8],
    soonProviderIds: [8],
    updatedAt: NOW,
    ...over,
  };
}

function soon(over: Partial<HouseholdSoonOverview> = {}): HouseholdSoonOverview {
  return { reportedCount: 3, unknownCount: 0, visible: true, soonCountByProvider: { 8: 1 }, ...over };
}

beforeEach(() => {
  state.status = 'active';
  state.contributions = [contribution('u1'), contribution('u2'), contribution('u3')];
  state.needsReshare = false;
  state.myVotes = {};
  state.soon = soon();
  state.names = { u1: 'Malin', u2: 'Anna', u3: 'Olle' };
  state.setVote.mockClear();
  state.optIn.mockClear();
  state.optOut.mockClear();
});

describe('HouseholdMode — lägen', () => {
  it('visar en skelett medan hushållet läses', () => {
    state.status = 'loading';
    const { container } = render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    expect(container.querySelector('[data-skeleton]')).not.toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('visar en felrad vid läsfel', () => {
    state.status = 'error';
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Kunde inte läsa hushållsdatan');
  });

  it('en som inte delar ser kortet "Se vad hushållet sparar" och den delade samtyckesvyn', () => {
    state.status = 'gated';
    state.contributions = [];
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    expect(screen.getByRole('heading', { name: 'Se vad hushållet sparar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dela mina kostnader…' }));
    const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('I appen visas bara totalsiffror — men tekniskt kan delande gruppmedlemmar nå din enskilda lista.');
    fireEvent.click(screen.getByRole('button', { name: 'Dela' }));
    expect(state.optIn).toHaveBeenCalledTimes(1);
  });

  it('en delare från före soon-fältet uppmanas "Läs och dela igen"', () => {
    state.needsReshare = true;
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    fireEvent.click(screen.getByRole('button', { name: 'Läs och dela igen…' }));
    expect(screen.getByText('Dela igen med det nya?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dela' }));
    expect(state.optIn).toHaveBeenCalledTimes(1);
  });

  it('en delare från före soon-fältet kan inte rösta förrän hen delat igen', () => {
    state.needsReshare = true;
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    for (const b of screen.getAllByRole('button', { name: 'Behåll' })) {
      expect(b).toBeDisabled();
      fireEvent.click(b);
    }
    expect(state.setVote).not.toHaveBeenCalled();
    expect(screen.getAllByText(/för att kunna rösta/).length).toBeGreaterThan(0);
  });
});

describe('HouseholdMode — månadsdomen', () => {
  const hero = () => screen.getByRole('region', { name: 'Hushållet den här månaden' });

  it('pausa: ingen av tre ser något nytt', () => {
    state.soon = soon({ soonCountByProvider: {} });
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    expect(within(hero()).getByText(/Inget nytt på väg på Netflix enligt era bevakningar i appen\. Pausa och spara 507 kr\/mån\./)).toBeInTheDocument();
  });

  it('visar "0 av N" bara när aggregatet är synligt (tre eller fler), och pausar då inte på två', () => {
    state.contributions = [contribution('u1'), contribution('u2', { providerIds: [], providerCosts: {}, activeProviderIds: [] })];
    state.soon = soon({ reportedCount: 2, visible: false, soonCountByProvider: {} });
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    expect(screen.queryByText(/\d av \d har något nytt/)).toBeNull();
    expect(within(hero()).queryByText(/Inget nytt på väg/)).toBeNull();
    expect(within(hero()).getByText('Allt ser rimligt ut.')).toBeInTheDocument();
  });

  it('dubbelt: samma tjänst betalas av två', () => {
    state.contributions = [contribution('u1'), contribution('u2')];
    state.soon = soon({ reportedCount: 2, visible: false, soonCountByProvider: {} });
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    expect(within(hero()).getByText(/Ni betalar Netflix två gånger\. Behåll ett abonnemang och spara 169 kr\/mån\./)).toBeInTheDocument();
    expect(screen.getByText('Betalas dubbelt')).toBeInTheDocument();
  });

  it('rimligt: en betalare och något nytt', () => {
    state.contributions = [contribution('u1'), contribution('u2', { providerIds: [], providerCosts: {}, activeProviderIds: [], soonProviderIds: [] }), contribution('u3', { providerIds: [], providerCosts: {}, activeProviderIds: [], soonProviderIds: [] })];
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    expect(within(hero()).getByText('Allt ser rimligt ut.')).toBeInTheDocument();
    expect(screen.getByText('Behåll', { selector: 'span' })).toBeInTheDocument();
  });
});

describe('HouseholdMode — tjänstelistan', () => {
  it('visar dom-pill, "N av M har något nytt", summa tillsammans och vilka som delar', () => {
    state.contributions = [contribution('u1'), contribution('u2', { providerIds: [], providerCosts: {}, activeProviderIds: [] }), contribution('u3', { providerIds: [], providerCosts: {}, activeProviderIds: [] })];
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    expect(screen.getByText('1 av 3 har något nytt')).toBeInTheDocument();
    expect(screen.getByText(/169 kr\/mån/, { selector: 'span.font-semibold' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vilka delar' })).toBeInTheDocument();
    expect(screen.getByText(/Malin, Anna, Olle/)).toBeInTheDocument();
  });

  it('"Din delning": Sluta dela anropar optOut och en länk leder till vad som delas', () => {
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sluta dela' }));
    expect(state.optOut).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Vad delas?' })).toHaveAttribute('href', '/integritet#grupper');
  });
});

describe('HouseholdMode — röster', () => {
  const netflixRow = () => screen.getByRole('group', { name: 'Din röst om Netflix' }).closest('li') as HTMLElement;

  it('en röst anropar setVote med tjänst och värde', async () => {
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    const group = screen.getByRole('group', { name: 'Din röst om Netflix' });
    // Knapparna är låsta medan en röst sparas, så vänta in varje svar.
    for (const [label, vote] of [['Ok med paus', 'ok'], ['Behåll', 'keep'], ['Vänta, jag ska se något', 'wait']] as const) {
      fireEvent.click(within(group).getByRole('button', { name: label }));
      expect(state.setVote).toHaveBeenLastCalledWith(8, vote);
      await waitFor(() => expect(within(group).getByRole('button', { name: label })).not.toBeDisabled());
    }
  });

  it('markerar mitt val och tar bort det när jag trycker igen', async () => {
    state.myVotes = { 8: 'keep' };
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    const group = screen.getByRole('group', { name: 'Din röst om Netflix' });
    expect(within(group).getByRole('button', { name: 'Behåll' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Ok med paus' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(within(group).getByRole('button', { name: 'Behåll' }));
    expect(state.setVote).toHaveBeenLastCalledWith(8, null);
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Behåll' })).not.toBeDisabled());
  });

  it('visar alla röster med namn, och en sammanfattning', () => {
    state.contributions = [
      contribution('u1', { votes: { 8: 'ok' }, votesMonth: MONTH }),
      contribution('u2', { votes: { 8: 'ok' }, votesMonth: MONTH }),
      contribution('u3', { votes: { 8: 'keep' }, votesMonth: MONTH }),
    ];
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    const row = within(netflixRow());
    expect(row.getByText('Malin (du)')).toBeInTheDocument();
    expect(row.getByText('Anna')).toBeInTheDocument();
    expect(row.getByText('Olle')).toBeInTheDocument();
    expect(row.getByText('2 av 3 är ok med paus · 1 vill behålla')).toBeInTheDocument();
    expect(row.queryByText(/Alla är överens/)).toBeNull();
  });

  it('"Alla är överens: pausa X" när alla delare svarat ok', () => {
    state.contributions = ['u1', 'u2', 'u3'].map(uid => contribution(uid, { votes: { 8: 'ok' }, votesMonth: MONTH }));
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    expect(within(netflixRow()).getByText('Alla är överens: pausa Netflix')).toBeInTheDocument();
  });

  it('röster från en tidigare månad räknas inte', () => {
    state.contributions = ['u1', 'u2', 'u3'].map(uid => contribution(uid, { votes: { 8: 'ok' }, votesMonth: '2026-09' }));
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    expect(screen.queryByText(/Alla är överens/)).toBeNull();
    expect(screen.queryByText(/är ok med paus/)).toBeNull();
  });

  it('visar en felrad när rösten inte kunde sparas', async () => {
    state.setVote.mockRejectedValueOnce(new Error('nej'));
    render(<HouseholdMode groupId="g1" groupName="Hemmet" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ok med paus' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunde inte spara din röst');
  });
});
