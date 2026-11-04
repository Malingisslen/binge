// Värdens "Kör om" i slutsteget: bara värden ser knappen, och omkörningen skriver nya titlar.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionMain } from './TillsammansSessionPageClient';
import { setSessionCandidates } from '@/lib/firebase/sessions';
import { generateCandidates } from '@/lib/together/candidates';
import type { SessionCandidate, SessionParticipant, SessionSwipe, TogetherSession } from '@/types';

const auth = vi.hoisted(() => ({ uid: 'me' as string | null }));
vi.mock('next/link', () => ({ default: ({ children, ...p }: { children: React.ReactNode }) => <a {...p}>{children}</a> }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: auth.uid, user: null }) }));
vi.mock('@/hooks/useSession', () => ({
  useSession: vi.fn(), getStoredParticipantId: vi.fn(), storeParticipantId: vi.fn(),
}));
vi.mock('@/hooks/useSessionTasteVectors', () => ({ useSessionTasteVectors: () => new Map() }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('@/lib/firebase/sessions', () => ({ joinSession: vi.fn(), recordSwipe: vi.fn(), setSessionCandidates: vi.fn() }));
vi.mock('@/lib/together/candidates', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/together/candidates')>()),
  generateCandidates: vi.fn(),
}));

const mk = (tmdbId: number, title: string) =>
  ({ tmdbId, mediaType: 'movie', title, posterPath: null, year: 2020, voteAverage: 7, overview: '', genreIds: [], providers: [] }) as unknown as SessionCandidate;
const now = new Date();
const me = { id: 'me', uid: 'me', displayName: 'Malin', providers: [8], vetoRemaining: 1, isHost: true, lastActiveAt: now, joinedAt: now } as unknown as SessionParticipant;
const other = { ...me, id: 'other', uid: 'other', displayName: 'Kim', isHost: false } as SessionParticipant;
const swipes = [1, 2].map(id => ({ tmdbId: id, mediaType: 'movie', votes: { me: 'yes', other: 'yes' }, updatedAt: now })) as SessionSwipe[];

function renderFinal(
  hostUid: string | null,
  opts: { me?: SessionParticipant; participants?: SessionParticipant[]; swipes?: SessionSwipe[] } = {},
) {
  const meP = opts.me ?? me;
  const session = {
    id: 's1', hostUid, candidates: [mk(1, 'A'), mk(2, 'B')],
    config: { providerMode: 'union', aggregation: 'average', mediaType: 'movie', maxRuntimeMin: null, allowAsymmetry: false },
  } as unknown as TogetherSession;
  return render(<SessionMain sessionId="s1" session={session} participants={opts.participants ?? [me, other]} swipes={opts.swipes ?? swipes} me={meP} />);
}

beforeEach(() => {
  auth.uid = 'me';
  vi.mocked(setSessionCandidates).mockReset().mockResolvedValue(undefined);
  vi.mocked(generateCandidates).mockReset();
});

describe('Kör om', () => {
  it('syns för värden', () => {
    renderFinal('me');
    expect(screen.getByRole('button', { name: 'Kör om' })).toBeInTheDocument();
  });

  it('syns inte för en deltagare', () => {
    auth.uid = 'other';
    renderFinal('me');
    expect(screen.queryByRole('button', { name: 'Kör om' })).toBeNull();
  });

  it('frågar först och skriver inget förrän värden bekräftar', () => {
    renderFinal('me');
    fireEvent.click(screen.getByRole('button', { name: 'Kör om' }));
    expect(screen.getByText(/Kör om med nya titlar\?/)).toBeInTheDocument();
    expect(generateCandidates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }));
    expect(screen.getByRole('button', { name: 'Kör om' })).toBeInTheDocument();
  });

  it('hämtar nya titlar utan de gamla och sparar dem', async () => {
    const fresh = [mk(3, 'C')];
    vi.mocked(generateCandidates).mockResolvedValue(fresh);
    renderFinal('me');
    fireEvent.click(screen.getByRole('button', { name: 'Kör om' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, kör om' }));
    await waitFor(() => expect(setSessionCandidates).toHaveBeenCalledWith('s1', fresh));
    const args = vi.mocked(generateCandidates).mock.calls[0][0];
    expect([...(args.excludeTmdbIds ?? [])]).toEqual(expect.arrayContaining(['movie_1', 'movie_2']));
    expect(args.providers).toEqual([8]);
  });

  it('visar fel och sparar inget när hämtningen faller', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(generateCandidates).mockRejectedValue(new Error('tmdb'));
    renderFinal('me');
    fireEvent.click(screen.getByRole('button', { name: 'Kör om' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, kör om' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Det gick inte att köra om');
    expect(setSessionCandidates).not.toHaveBeenCalled();
  });

  it('ersätter inte titlarna med en tom lista', async () => {
    vi.mocked(generateCandidates).mockResolvedValue([]);
    renderFinal('me');
    fireEvent.click(screen.getByRole('button', { name: 'Kör om' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, kör om' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Hittade inga nya titlar');
    expect(setSessionCandidates).not.toHaveBeenCalled();
  });

  it('tar inte tillbaka en titel som redan har röster från en tidigare omgång', async () => {
    vi.mocked(generateCandidates).mockResolvedValue([mk(3, 'C')]);
    const earlier = { tmdbId: 9, mediaType: 'tv', votes: { me: 'yes' }, updatedAt: now } as unknown as SessionSwipe;
    renderFinal('me', { swipes: [...swipes, earlier] });
    fireEvent.click(screen.getByRole('button', { name: 'Kör om' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, kör om' }));
    await waitFor(() => expect(generateCandidates).toHaveBeenCalled());
    const excluded = [...(vi.mocked(generateCandidates).mock.calls[0][0].excludeTmdbIds ?? [])];
    expect(excluded).toContain('tv_9');
    expect(excluded).toEqual(expect.arrayContaining(['movie_1', 'movie_2']));
  });

  it('faller tillbaka på värdens egna tjänster när inga gemensamma finns', async () => {
    vi.mocked(generateCandidates).mockResolvedValue([mk(3, 'C')]);
    const host = { ...me, providers: [8, 9] } as SessionParticipant;
    const noServices = { ...other, providers: [] } as SessionParticipant;
    renderFinal('me', { me: host, participants: [noServices] });
    fireEvent.click(screen.getByRole('button', { name: 'Kör om' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, kör om' }));
    await waitFor(() => expect(generateCandidates).toHaveBeenCalled());
    expect(vi.mocked(generateCandidates).mock.calls[0][0].providers).toEqual([8, 9]);
  });

  it('söker inte när varken gemensamma eller egna tjänster finns', async () => {
    const host = { ...me, providers: [] } as SessionParticipant;
    const noServices = { ...other, providers: [] } as SessionParticipant;
    renderFinal('me', { me: host, participants: [noServices] });
    fireEvent.click(screen.getByRole('button', { name: 'Kör om' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, kör om' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingen streamingtjänst att söka på');
    expect(generateCandidates).not.toHaveBeenCalled();
    expect(setSessionCandidates).not.toHaveBeenCalled();
  });

  it('stänger bekräftelsen efter lyckad sparning', async () => {
    vi.mocked(generateCandidates).mockResolvedValue([mk(3, 'C')]);
    renderFinal('me');
    fireEvent.click(screen.getByRole('button', { name: 'Kör om' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, kör om' }));
    await waitFor(() => expect(setSessionCandidates).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/Kör om med nya titlar\?/)).toBeNull());
    expect(screen.getByRole('button', { name: 'Kör om' })).toBeInTheDocument();
  });

  it('visar fel när sparningen av nya titlar faller', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(generateCandidates).mockResolvedValue([mk(3, 'C')]);
    vi.mocked(setSessionCandidates).mockRejectedValue(new Error('denied'));
    renderFinal('me');
    fireEvent.click(screen.getByRole('button', { name: 'Kör om' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, kör om' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Det gick inte att köra om');
    expect(screen.getByText(/Kör om med nya titlar\?/)).toBeInTheDocument();
  });
});
