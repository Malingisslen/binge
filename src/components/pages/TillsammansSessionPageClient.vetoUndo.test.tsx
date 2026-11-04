// Ångra veto (BIN-1490): inloggade på egen plats kan ångra sitt veto; anonyma gäster ser ingen knapp.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SessionMain } from './TillsammansSessionPageClient';
import { recordSwipe, undoVeto } from '@/lib/firebase/sessions';
import { VETO_UNDO_STRIP_MS } from '@/lib/together/vetoUndo';
import type { SessionCandidate, SessionParticipant, SessionSwipe, TogetherSession } from '@/types';

vi.mock('next/link', () => ({ default: ({ children, ...p }: { children: React.ReactNode }) => <a {...p}>{children}</a> }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'me', user: null }) }));
vi.mock('@/hooks/useSession', () => ({
  useSession: vi.fn(), getStoredParticipantId: vi.fn(), storeParticipantId: vi.fn(),
}));
vi.mock('@/hooks/useSessionTasteVectors', () => ({ useSessionTasteVectors: () => new Map() }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('@/lib/firebase/sessions', () => ({
  joinSession: vi.fn(), recordSwipe: vi.fn(), setSessionCandidates: vi.fn(), undoVeto: vi.fn(),
}));

const mk = (tmdbId: number, title: string) =>
  ({ tmdbId, mediaType: 'movie', title, posterPath: null, year: 2020, voteAverage: 7, overview: '', genreIds: [], providers: [] }) as unknown as SessionCandidate;
const now = new Date();
const signedIn = { id: 'me', uid: 'me', displayName: 'Malin', providers: [8], vetoRemaining: 1, isHost: false, lastActiveAt: now, joinedAt: now } as unknown as SessionParticipant;
const ANON = '0123456789abcdef0123456789abcdef';
const anon = { ...signedIn, id: ANON, uid: null, displayName: 'Gäst' } as SessionParticipant;
const other = { ...signedIn, id: 'other', uid: 'other', displayName: 'Kim' } as SessionParticipant;
const session = {
  id: 's1', hostUid: 'other', candidates: [mk(1, 'Alfa'), mk(2, 'Beta')],
  config: { providerMode: 'union', aggregation: 'average', mediaType: 'movie', maxRuntimeMin: null, allowAsymmetry: false },
} as unknown as TogetherSession;
const vetoSwipe = (pid: string) => [{ tmdbId: 1, mediaType: 'movie', votes: { [pid]: 'veto' }, updatedAt: now }] as SessionSwipe[];

function main(me: SessionParticipant, swipes: SessionSwipe[] = []) {
  return <SessionMain sessionId="s1" session={session} participants={[me, other]} swipes={swipes} me={me} />;
}

async function confirmVetoOnCard() {
  fireEvent.click(screen.getByRole('button', { name: /^Veto$/ }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ja, veto' })); });
}

beforeEach(() => {
  vi.mocked(recordSwipe).mockReset().mockResolvedValue(undefined);
  vi.mocked(undoVeto).mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe('Ångra veto — inloggad på egen plats', () => {
  it('visar remsan efter ett bekräftat veto och ångrar via undoVeto', async () => {
    render(main(signedIn));
    await confirmVetoOnCard();
    expect(screen.getByText('Veto lagt.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ångra veto' })); });
    expect(undoVeto).toHaveBeenCalledWith({ sessionId: 's1', participantId: 'me', tmdbId: 1, mediaType: 'movie' });
    expect(screen.getByText('Veto ångrat. Du har ditt veto kvar.').closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByText('Veto lagt.')).toBeNull();
  });

  it('remsan försvinner efter en stund, och knappen ligger kvar så länge rösten är veto', async () => {
    vi.useFakeTimers();
    const { rerender } = render(main(signedIn));
    await confirmVetoOnCard();
    rerender(main({ ...signedIn, vetoRemaining: 0 }, vetoSwipe('me')));
    expect(screen.getByText('Veto lagt.')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(VETO_UNDO_STRIP_MS); });
    expect(screen.queryByText('Veto lagt.')).toBeNull();
    expect(screen.getByText(/Ditt veto: Alfa/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ångra veto' })).toBeInTheDocument();
  });

  it('visar ett fel och behåller knappen när ångrandet misslyckas', async () => {
    vi.mocked(undoVeto).mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(main({ ...signedIn, vetoRemaining: 0 }, vetoSwipe('me')));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ångra veto' })); });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Vetot kunde inte ångras.'));
    expect(screen.getByRole('button', { name: 'Ångra veto' })).toBeEnabled();
    expect(screen.queryByText('Veto ångrat. Du har ditt veto kvar.')).toBeNull();
  });

  it('tabellen har en ångra-knapp på raden jag lagt veto på', async () => {
    render(main({ ...signedIn, vetoRemaining: 0 }, vetoSwipe('me')));
    fireEvent.click(screen.getByRole('button', { name: /Tabell/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ångra veto på Alfa' })); });
    expect(undoVeto).toHaveBeenCalledWith({ sessionId: 's1', participantId: 'me', tmdbId: 1, mediaType: 'movie' });
    expect(screen.queryByRole('button', { name: 'Ångra veto på Beta' })).toBeNull();
  });
});

describe('Ångra veto — anonym gäst', () => {
  it('får ingen remsa efter ett veto', async () => {
    render(main(anon));
    await confirmVetoOnCard();
    expect(recordSwipe).toHaveBeenCalled();
    expect(screen.queryByText('Veto lagt.')).toBeNull();
    expect(screen.queryByRole('button', { name: /Ångra veto/ })).toBeNull();
  });

  it('ser ingen ångra-knapp i kort eller tabell', () => {
    render(main({ ...anon, vetoRemaining: 0 }, vetoSwipe(ANON)));
    expect(screen.queryByRole('button', { name: /Ångra veto/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Tabell/ }));
    expect(screen.queryByRole('button', { name: /Ångra veto/ })).toBeNull();
  });
});
