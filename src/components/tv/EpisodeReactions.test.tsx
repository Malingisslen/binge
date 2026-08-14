import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import EpisodeReactions from './EpisodeReactions';
import type { EpisodeReaction } from '@/hooks/useEpisodeReactions';

// BIN-821 — the per-episode reaction thread (BIN-95) had no tests at all, and the
// thing it exists to protect is a SPOILER GATE with two independent layers:
//
//   1. the whole thread is shut until the viewer has marked THIS episode watched, and
//   2. inside an open thread, a reaction its author flagged as a spoiler (for LATER
//      events) is blurred until clicked.
//
// Both are "absence" behaviours — nothing on screen is what proves them — so every
// cheap mutant (drop the `!watched` early return, invert the `spoiler` flag, subscribe
// eagerly) leaves a green screen and a leaked plot twist. SeasonList.test.tsx pins what
// EpisodeRow FORWARDS to this component and explicitly notes that the gate's own branch
// is untested; this file is that branch.

// The hook talks to Firestore (and imports the Firebase config module, which boots the
// Auth SDK at import time), so it is mocked. `calls` is the load-bearing part: the hook
// IS the subscription, so "was it called, and with what" is how we prove no listener
// opens for an unwatched episode and that the (tmdbId, season, episode) triple — the
// Firestore document key `${tmdbId}_${season}_${episode}` — is forwarded intact.
const hook = vi.hoisted(() => ({
  calls: [] as { tmdbId: number; season: number; episode: number; enabled: boolean }[],
  state: {
    reactions: [] as EpisodeReaction[],
    loading: false,
    currentUid: 'me' as string | null,
  },
  addReaction: vi.fn(),
  deleteReaction: vi.fn(),
}));

vi.mock('@/hooks/useEpisodeReactions', () => ({
  useEpisodeReactions: (tmdbId: number, season: number, episode: number, enabled: boolean) => {
    hook.calls.push({ tmdbId, season, episode, enabled });
    return {
      reactions: hook.state.reactions,
      loading: hook.state.loading,
      addReaction: hook.addReaction,
      deleteReaction: hook.deleteReaction,
      currentUid: hook.state.currentUid,
    };
  },
}));

// Deliberately distinct numbers: 1396/3/7 share no value, so an implementation that
// swapped two of the three arguments (the mistake that would post into a different
// episode's thread) cannot pass by coincidence.
const TMDB_ID = 1396;
const SEASON = 3;
const EPISODE = 7;

function reaction(over: Partial<EpisodeReaction> & { id: string }): EpisodeReaction {
  return {
    uid: 'other',
    text: 'Bra avsnitt.',
    spoiler: false,
    displayName: 'Bo',
    username: 'bo',
    createdAt: new Date('2026-03-01T12:00:00Z'),
    ...over,
  };
}

function renderThread(watched: boolean) {
  return render(<EpisodeReactions tmdbId={TMDB_ID} season={SEASON} episode={EPISODE} watched={watched} />);
}

const GATE_COPY = /^Reaktioner visas när du markerat avsnittet som sett/;

describe('EpisodeReactions — the spoiler gate on the viewer\'s own progress (BIN-821)', () => {
  beforeEach(() => {
    hook.calls.length = 0;
    hook.state.reactions = [];
    hook.state.loading = false;
    hook.state.currentUid = 'me';
    hook.addReaction.mockReset();
    hook.addReaction.mockResolvedValue({ ok: true });
    hook.deleteReaction.mockReset();
  });

  it('shows no thread, no opener and NO subscription for an unwatched episode', () => {
    // The reactions are inherently spoilery for the episode they discuss, so the gate
    // has to stop the DATA, not just the rendering. Asserting the hook was never called
    // is what kills the "render the thread but hide it with CSS" and the "subscribe
    // eagerly, gate the markup" mutants — both of which put the text in the DOM.
    hook.state.reactions = [reaction({ id: 'r1', text: 'HAN DÖR PÅ SLUTET' })];
    renderThread(false);

    expect(screen.getByText(GATE_COPY)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Visa reaktioner' })).toBeNull();
    expect(screen.queryByText('HAN DÖR PÅ SLUTET')).toBeNull();
    expect(hook.calls).toHaveLength(0);
  });

  it('opens up the whole way once the episode is marked watched — held, flipped, released', () => {
    // Drive the transition rather than two separate renders: the gate is a state that
    // must LIFT, and a mutant that latches shut on the first render (or one that only
    // ever renders the watched branch) is invisible to a pair of one-shot renders.
    hook.state.reactions = [reaction({ id: 'r1' })];
    const { rerender } = renderThread(false);
    expect(screen.getByText(GATE_COPY)).toBeInTheDocument();

    rerender(<EpisodeReactions tmdbId={TMDB_ID} season={SEASON} episode={EPISODE} watched />);

    // Watched, but still collapsed — the listener stays closed until the viewer opens
    // the thread (one Firestore listener per expanded episode, never per row).
    expect(screen.queryByText(GATE_COPY)).toBeNull();
    expect(hook.calls).toHaveLength(0);
    const opener = screen.getByRole('button', { name: 'Visa reaktioner' });

    fireEvent.click(opener);

    expect(screen.getByText('Bra avsnitt.')).toBeInTheDocument();
    // Exact triple + enabled. This is the Firestore doc key; a swapped or hardcoded
    // argument posts and reads someone else's episode thread.
    expect(hook.calls.every(c => c.tmdbId === TMDB_ID && c.season === SEASON && c.episode === EPISODE)).toBe(true);
    expect(hook.calls.every(c => c.enabled === true)).toBe(true);
  });

  it('collapses back to the opener, and stops reading, when the viewer hides it', () => {
    hook.state.reactions = [reaction({ id: 'r1' })];
    renderThread(true);
    fireEvent.click(screen.getByRole('button', { name: 'Visa reaktioner' }));
    expect(screen.getByText('Bra avsnitt.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dölj' }));

    expect(screen.queryByText('Bra avsnitt.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Visa reaktioner' })).toBeInTheDocument();
  });

  it('blurs a reaction flagged as a spoiler and reveals only the one that was clicked', () => {
    // Per-item state, asserted with TWO spoilers: `revealed` hoisted to the thread
    // instead of the item would uncover both at once, and a single-spoiler fixture
    // cannot tell those apart. The unflagged reaction pins the false branch, so
    // "mask everything" fails too.
    hook.state.reactions = [
      reaction({ id: 'r1', text: 'HAN DÖR I FINALEN', spoiler: true }),
      reaction({ id: 'r2', text: 'OCH HON TAR ÖVER', spoiler: true }),
      reaction({ id: 'r3', text: 'Snyggt fotat.', spoiler: false }),
    ];
    renderThread(true);
    fireEvent.click(screen.getByRole('button', { name: 'Visa reaktioner' }));

    expect(screen.queryByText('HAN DÖR I FINALEN')).toBeNull();
    expect(screen.queryByText('OCH HON TAR ÖVER')).toBeNull();
    expect(screen.getByText('Snyggt fotat.')).toBeInTheDocument();

    const masks = screen.getAllByRole('button', { name: 'Spoiler — klicka för att visa' });
    expect(masks).toHaveLength(2);

    fireEvent.click(masks[0]);

    expect(screen.getByText('HAN DÖR I FINALEN')).toBeInTheDocument();
    expect(screen.queryByText('OCH HON TAR ÖVER')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Spoiler — klicka för att visa' })).toHaveLength(1);
  });

  it('offers "Ta bort" on the viewer\'s own reaction only, and deletes that id', () => {
    hook.state.currentUid = 'me';
    hook.state.reactions = [
      reaction({ id: 'r-theirs', uid: 'other', text: 'Deras.' }),
      reaction({ id: 'r-mine', uid: 'me', text: 'Min.' }),
    ];
    renderThread(true);
    fireEvent.click(screen.getByRole('button', { name: 'Visa reaktioner' }));

    const deletes = screen.getAllByRole('button', { name: 'Ta bort' });
    expect(deletes).toHaveLength(1);

    fireEvent.click(deletes[0]);

    // The id, not just "was called": a handler wired to the wrong row deletes a
    // stranger's reaction, and the count assertion above cannot see that.
    expect(hook.deleteReaction).toHaveBeenCalledTimes(1);
    expect(hook.deleteReaction).toHaveBeenCalledWith('r-mine');
  });

  it('hides the composer from a signed-out viewer but still shows the thread', () => {
    hook.state.currentUid = null;
    hook.state.reactions = [reaction({ id: 'r1', text: 'Bra avsnitt.' })];
    renderThread(true);
    fireEvent.click(screen.getByRole('button', { name: 'Visa reaktioner' }));

    expect(screen.queryByPlaceholderText('Vad tyckte du om avsnittet?')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Posta' })).toBeNull();
    expect(screen.getByText('Bra avsnitt.')).toBeInTheDocument();
  });

  it('posts the text AND the spoiler flag, then clears both', async () => {
    renderThread(true);
    fireEvent.click(screen.getByRole('button', { name: 'Visa reaktioner' }));

    const box = screen.getByPlaceholderText('Vad tyckte du om avsnittet?') as HTMLTextAreaElement;
    const flag = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'Bästa avsnittet hittills.' } });
    fireEvent.click(flag);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Posta' })); });

    // The flag is the second half of the gate: dropped on the way to the hook, every
    // spoiler reaction renders unblurred for everyone.
    expect(hook.addReaction).toHaveBeenCalledTimes(1);
    expect(hook.addReaction).toHaveBeenCalledWith('Bästa avsnittet hittills.', true);
    expect(box.value).toBe('');
    expect(flag.checked).toBe(false);
  });

  it('disables the post button while the write is in flight, and re-enables it after', async () => {
    // A state that appears and vanishes is invisible in the end state, so the promise is
    // held open on purpose: without the busy latch a double-tap posts the reaction twice.
    let release: (v: { ok: boolean }) => void = () => {};
    hook.addReaction.mockImplementation(() => new Promise(res => { release = res; }));
    renderThread(true);
    fireEvent.click(screen.getByRole('button', { name: 'Visa reaktioner' }));
    fireEvent.change(screen.getByPlaceholderText('Vad tyckte du om avsnittet?'), { target: { value: 'Wow.' } });

    const post = screen.getByRole('button', { name: 'Posta' });
    fireEvent.click(post);
    expect(post).toBeDisabled();

    await act(async () => { release({ ok: true }); });

    expect(post).not.toBeDisabled();
    expect(hook.addReaction).toHaveBeenCalledTimes(1);
  });

  it('keeps the typed text on screen when the write fails, and shows why', async () => {
    hook.addReaction.mockResolvedValue({ ok: false, error: 'Kunde inte spara reaktionen.' });
    renderThread(true);
    fireEvent.click(screen.getByRole('button', { name: 'Visa reaktioner' }));
    const box = screen.getByPlaceholderText('Vad tyckte du om avsnittet?') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Ett långt inlägg.' } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Posta' })); });

    expect(screen.getByText('Kunde inte spara reaktionen.')).toBeInTheDocument();
    // Clearing on failure throws away what the user wrote — the clear belongs to the
    // success branch only, and the happy-path test above cannot see the difference.
    expect(box.value).toBe('Ett långt inlägg.');
  });

  it('falls back to a generic message when the failure carries no reason', async () => {
    hook.addReaction.mockResolvedValue({ ok: false });
    renderThread(true);
    fireEvent.click(screen.getByRole('button', { name: 'Visa reaktioner' }));
    fireEvent.change(screen.getByPlaceholderText('Vad tyckte du om avsnittet?'), { target: { value: 'Hej.' } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Posta' })); });

    expect(screen.getByText('Kunde inte spara.')).toBeInTheDocument();
  });

  it('shows the loading and the empty state instead of an empty box', () => {
    hook.state.loading = true;
    const { unmount } = renderThread(true);
    fireEvent.click(screen.getByRole('button', { name: 'Visa reaktioner' }));
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByText('Laddar reaktioner…').length).toBeGreaterThan(0);
    unmount();

    hook.state.loading = false;
    renderThread(true);
    fireEvent.click(screen.getByRole('button', { name: 'Visa reaktioner' }));
    expect(screen.getByText('Inga reaktioner än — bli först.')).toBeInTheDocument();
  });

  it('labels a reaction by display name, then username, then a neutral fallback', () => {
    hook.state.reactions = [
      reaction({ id: 'r1', uid: 'a', text: 'Ett.', displayName: 'Alva', username: 'alva' }),
      reaction({ id: 'r2', uid: 'b', text: 'Två.', displayName: null, username: 'bo' }),
      reaction({ id: 'r3', uid: 'c', text: 'Tre.', displayName: null, username: null }),
    ];
    renderThread(true);
    fireEvent.click(screen.getByRole('button', { name: 'Visa reaktioner' }));

    expect(screen.getByText('Alva')).toBeInTheDocument();
    expect(screen.getByText('bo')).toBeInTheDocument();
    expect(screen.getByText('Användare')).toBeInTheDocument();
  });
});
