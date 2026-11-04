// Tillsammans-sessionen: tillgänglighet för röstknapparna, vetodialogen och delningsknappen.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SwipeCard, CandidateTable, SessionMain } from './TillsammansSessionPageClient';
import { recordSwipe } from '@/lib/firebase/sessions';
import { ShareSessionButton } from '@/components/together/ShareSessionButton';
import type { SessionCandidate, SessionParticipant, SessionSwipe, TogetherSession } from '@/types';

vi.mock('next/link', () => ({ default: ({ children, ...p }: { children: React.ReactNode }) => <a {...p}>{children}</a> }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'me', user: null }) }));
vi.mock('@/hooks/useSession', () => ({
  useSession: vi.fn(), getStoredParticipantId: vi.fn(), storeParticipantId: vi.fn(),
}));
vi.mock('@/hooks/useSessionTasteVectors', () => ({ useSessionTasteVectors: () => new Map() }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('@/lib/firebase/sessions', () => ({ joinSession: vi.fn(), recordSwipe: vi.fn() }));

const cand: SessionCandidate = {
  tmdbId: 1, mediaType: 'movie', title: 'Testfilm', posterPath: null, year: 2020,
  voteAverage: 7, overview: '', genreIds: [], providers: [],
} as unknown as SessionCandidate;

const me = { id: 'me', uid: 'me', displayName: 'Malin', providers: [], vetoRemaining: 1 } as unknown as SessionParticipant;

function card(props: { myVote?: 'yes' | 'no' | 'veto'; vetoConfirm?: boolean; onCancelVeto?: () => void; disabled?: boolean } = {}) {
  return render(
    <SwipeCard
      cand={cand} me={me} participants={[me]} onVote={vi.fn()} progress={{ done: 0, total: 1 }}
      myVote={props.myVote} vetoConfirm={props.vetoConfirm ?? false}
      onCancelVeto={props.onCancelVeto ?? vi.fn()} disabled={props.disabled ?? false}
    />,
  );
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share');
});

describe('röstknappar', () => {
  it('speglar nuvarande röst i aria-pressed', () => {
    card({ myVote: 'yes' });
    expect(screen.getByRole('button', { name: /Ja/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Nej/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Veto/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('har minst 44px tryckyta på kortet och i tabellen', () => {
    card();
    for (const name of [/Ja/, /Nej/, /Veto/]) {
      expect(screen.getByRole('button', { name }).className).toContain('min-h-11');
    }
  });

  it('kortets Nej och Veto speglar rösten i aria-pressed', () => {
    const no = card({ myVote: 'no' });
    expect(screen.getByRole('button', { name: /Nej/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Ja/ })).toHaveAttribute('aria-pressed', 'false');
    no.unmount();
    card({ myVote: 'veto' });
    expect(screen.getByRole('button', { name: /Veto/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Nej/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('tabellens Veto har aria-pressed när jag lagt veto', () => {
    const scored = [{
      candidate: cand, votes: { me: 'veto' }, yesCount: 0, noCount: 0, vetoed: true,
      score: 0, tasteScore: 0, allVoted: true, missing: [],
    }] as never;
    render(<CandidateTable scored={scored} me={{ ...me, vetoRemaining: 0 }} onVote={vi.fn()} armedVetoKey={null} disabled={false} />);
    const veto = screen.getByRole('button', { name: 'Veto' });
    expect(veto).toHaveAttribute('aria-pressed', 'true');
    expect(veto.className).toContain('min-h-11');
  });

  it('tabellens knappar har aria-pressed och 44px tryckyta', () => {
    const scored = [{
      candidate: cand, votes: { me: 'no' }, yesCount: 0, noCount: 1, vetoed: false,
      score: 0, tasteScore: 0, allVoted: true, missing: [],
    }] as never;
    render(<CandidateTable scored={scored} me={me} onVote={vi.fn()} armedVetoKey={null} disabled={false} />);
    const no = screen.getByRole('button', { name: 'Nej' });
    expect(no).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Ja' })).toHaveAttribute('aria-pressed', 'false');
    expect(no.className).toContain('min-h-11');
  });
});

describe('vetodialogen', () => {
  it('är en dialog och flyttar fokus till Avbryt', () => {
    card({ vetoConfirm: true });
    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Avbryt' }));
  });

  it('stängs med Escape', () => {
    const onCancelVeto = vi.fn();
    card({ vetoConfirm: true, onCancelVeto });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancelVeto).toHaveBeenCalledTimes(1);
  });

  it('lämnar tillbaka fokus till vetoknappen när dialogen stängs', () => {
    const { rerender } = card();
    const veto = screen.getByRole('button', { name: /Veto/ });
    veto.focus();
    rerender(
      <SwipeCard cand={cand} me={me} participants={[me]} onVote={vi.fn()} progress={{ done: 0, total: 1 }}
        vetoConfirm onCancelVeto={vi.fn()} disabled={false} />,
    );
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    rerender(
      <SwipeCard cand={cand} me={me} participants={[me]} onVote={vi.fn()} progress={{ done: 0, total: 1 }}
        vetoConfirm={false} onCancelVeto={vi.fn()} disabled={false} />,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Veto/ }));
  });
});

describe('vetodialogens fokusfälla', () => {
  const buttons = () => within(screen.getByRole('dialog')).getAllByRole('button');

  it('har 44px tryckyta på dialogens knappar', () => {
    card({ vetoConfirm: true });
    for (const b of buttons()) expect(b.className).toContain('min-h-11');
  });

  it('Tab på sista knappen går till första', () => {
    card({ vetoConfirm: true });
    const [first, last] = [buttons()[0], buttons()[buttons().length - 1]];
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('Shift+Tab på första knappen går till sista', () => {
    card({ vetoConfirm: true });
    const [first, last] = [buttons()[0], buttons()[buttons().length - 1]];
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('Tab med fokus utanför dialogen drar in fokus', () => {
    card({ vetoConfirm: true });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons()[0]);
    outside.remove();
  });

  it('hoppar över den inaktiverade Ja, veto-knappen', () => {
    card({ vetoConfirm: true, disabled: true });
    expect(screen.getByRole('button', { name: 'Ja, veto' })).toBeDisabled();
    const avbryt = screen.getByRole('button', { name: 'Avbryt' });
    avbryt.focus();
    // fireEvent returns false when the handler called preventDefault: Avbryt is both the first
    // and last enabled button, so the trap holds Tab in both directions. Without the disabled
    // filter, Shift+Tab on Avbryt would not be prevented.
    expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(false);
    expect(fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(avbryt);
  });

  it('Escape stoppar propagering till andra lyssnare', () => {
    card({ vetoConfirm: true });
    // stopPropagation keeps the event from bubbling up to window; it does not silence
    // other listeners on document itself (that would need stopImmediatePropagation).
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    fireEvent.keyDown(document, { key: 'Escape' });
    window.removeEventListener('keydown', outer);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('SessionMain', () => {
  const cand2 = { ...cand, tmdbId: 2, title: 'Andra filmen' } as SessionCandidate;
  const other = { ...me, id: 'other', uid: 'other', displayName: 'Kim' } as SessionParticipant;
  const now = new Date();
  const people = [me, other].map(p => ({ ...p, lastActiveAt: now, joinedAt: now, isHost: false }));
  const session = {
    id: 's1', candidates: [cand, cand2],
    config: { providerMode: 'union', aggregation: 'average', mediaType: 'movie', maxRuntimeMin: null, allowAsymmetry: false },
  } as unknown as TogetherSession;
  const swipe = (votes: SessionSwipe['votes']) => ([{ tmdbId: 1, mediaType: 'movie', votes, updatedAt: now }] as SessionSwipe[]);
  const main = (swipes: SessionSwipe[]) => (
    <SessionMain sessionId="s1" session={session} participants={people} swipes={swipes} me={people[0]} />
  );
  const liveRegions = (c: HTMLElement) => Array.from(c.querySelectorAll('[aria-live="polite"]'));

  it('visar röstfelet i en egen live-region utan att skriva över matchtexten', async () => {
    vi.mocked(recordSwipe).mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, rerender } = render(main(swipe({ me: 'no' })));
    rerender(main(swipe({ me: 'yes', other: 'yes' })));
    const matchRegion = liveRegions(container).find(r => r.textContent === 'Ny match: Testfilm');
    expect(matchRegion).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Ja/ }));
    const errorText = 'Din röst kunde inte sparas. Kolla uppkopplingen och försök igen.';
    await waitFor(() => expect(liveRegions(container).some(r => r.textContent === errorText)).toBe(true));
    const errorRegion = liveRegions(container).find(r => r.textContent === errorText);
    expect(errorRegion).not.toBe(matchRegion);
    expect(matchRegion?.textContent).toBe('Ny match: Testfilm');
  });

  it('läser inte upp matcher som redan fanns när sidan öppnades', () => {
    const { container } = render(main(swipe({ me: 'yes', other: 'yes' })));
    expect(liveRegions(container).every(r => r.textContent === '')).toBe(true);
  });

  it('Kort/Tabell-växlaren speglar vald vy i aria-pressed', () => {
    render(main(swipe({})));
    const kort = screen.getByRole('button', { name: /Kort/ });
    const tabell = screen.getByRole('button', { name: /Tabell/ });
    expect(kort).toHaveAttribute('aria-pressed', 'true');
    expect(tabell).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(tabell);
    expect(tabell).toHaveAttribute('aria-pressed', 'true');
    expect(kort).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Dela-knappen', () => {
  it('syns inte utan navigator.share', () => {
    render(<ShareSessionButton url="https://binge.nu/tillsammans/abc/" />);
    expect(screen.queryByRole('button', { name: 'Dela' })).toBeNull();
  });

  it('delar bara sessionslänken med neutral text', () => {
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    render(<ShareSessionButton url="https://binge.nu/tillsammans/abc/" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dela' }));
    expect(share).toHaveBeenCalledWith({
      title: 'Tillsammans', text: 'Välj film tillsammans med mig.', url: 'https://binge.nu/tillsammans/abc/',
    });
  });
});
