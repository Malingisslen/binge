// src/components/social/FriendButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import FriendButton from './FriendButton';

// BIN-1129: a refused send used to be an unhandled rejection with nothing on
// screen. The rule now also refuses a sender the recipient has blocked, and the
// sender must not be able to tell that refusal from any other.
//
// BIN-1192: the same was true of the three other modes. They differ from the send
// path in one way that decides their copy — the blocked-list clause in
// `firestore.rules` gates `friendRequests` create and nothing else, so no refusal
// of cancel/accept/remove can be caused by a block. Each names its own action.

const actions = vi.hoisted(() => ({
  sendFriendRequest: vi.fn(async (_uid: string) => {}),
  cancelFriendRequest: vi.fn(async (_uid: string) => {}),
  acceptFriendRequest: vi.fn(async (_uid: string) => {}),
  removeFriend: vi.fn(async (_uid: string) => {}),
}));

const rel = vi.hoisted(() => ({ status: 'none' as string }));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ uid: 'me' }) }));
vi.mock('@/hooks/useFriends', () => ({
  useFriendStatus: () => ({ data: rel.status, isLoading: false }),
  useFriendActions: () => actions,
}));

// One row per mode: the relation that renders it, the button it renders, the
// action it calls, and the text that failure must produce. Driving every case
// from this table is what makes "each mode has its OWN text" checkable rather
// than asserted — see the distinctness test below, which reads the same column.
const MODES = [
  { status: 'none', button: 'Lägg till vän', fn: 'sendFriendRequest', text: 'Kunde inte skicka förfrågan.' },
  { status: 'sent', button: 'Förfrågan skickad', fn: 'cancelFriendRequest', text: 'Kunde inte avbryta förfrågan.' },
  { status: 'received', button: 'Acceptera vän', fn: 'acceptFriendRequest', text: 'Kunde inte acceptera förfrågan.' },
  { status: 'friends', button: 'Vän', fn: 'removeFriend', text: 'Kunde inte ta bort vännen.' },
] as const;

async function clickIn(mode: (typeof MODES)[number]) {
  rel.status = mode.status;
  const view = render(<FriendButton targetUid="them" />);
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: mode.button }));
  });
  return view;
}

describe('FriendButton — a refused write says so, per mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rel.status = 'none';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // A roster floor OUTSIDE the loop. `it.each([])` registers nothing and reports
  // PASS, so a halved or emptied table would silence every case below without
  // failing anything. The number is a LITERAL: derived from MODES.length it would
  // sink in lockstep and could never fail.
  it('covers every mode the button renders', () => {
    expect(MODES.length).toBe(4);
    expect(new Set(MODES.map((m) => m.status)).size).toBe(4);
  });

  it.each(MODES)('$status: a failed $fn says so next to the button', async (mode) => {
    actions[mode.fn].mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'permission-denied' }));
    const view = await clickIn(mode);

    expect(actions[mode.fn]).toHaveBeenCalledWith('them');
    expect(view.getByRole('alert').textContent).toBe(mode.text);
  });

  // The text may not depend on WHY the write failed. On the send path that is a
  // secrecy requirement — a block must not be readable out of the message. The
  // other three inherit the property because there is no reason to spend a second
  // string on distinguishing causes the user can do nothing about.
  it.each(MODES)('$status: shows the same text whatever the error was', async (mode) => {
    actions[mode.fn].mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'unavailable' }));
    const view = await clickIn(mode);

    expect(view.getByRole('alert').textContent).toBe(mode.text);
  });

  // The condition this test exists for: reusing one shared string across the four
  // modes would name the WRONG action for three of them. Read the rendered text
  // rather than the table, so a component that hardcodes one string fails here
  // even though the table still lists four.
  it('gives each mode its own text, rendered', async () => {
    const rendered: string[] = [];
    for (const mode of MODES) {
      actions[mode.fn].mockRejectedValueOnce(new Error('x'));
      const view = await clickIn(mode);
      rendered.push(view.getByRole('alert').textContent ?? '');
      view.unmount();
    }

    expect(rendered).toHaveLength(4);
    expect(new Set(rendered).size).toBe(4);
  });

  it.each(MODES)('$status: shows nothing when the write succeeds', async (mode) => {
    const view = await clickIn(mode);

    expect(view.queryByRole('alert')).toBeNull();
  });

  // A retry that succeeds must clear the earlier alert. Every other case clicks
  // once, so without this one the reset before each attempt could be deleted green.
  it('clears the alert when a retry succeeds', async () => {
    actions.sendFriendRequest.mockRejectedValueOnce(new Error('x'));
    const view = await clickIn(MODES[0]);
    expect(view.getByRole('alert')).toBeTruthy();

    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Lägg till vän' }));
    });

    expect(view.queryByRole('alert')).toBeNull();
  });

  // The relation can change under the button — the other person accepts in another
  // tab, or a request arrives. The old error is then about an action this button no
  // longer offers.
  it('drops the alert when the relation changes the button underneath it', async () => {
    actions.sendFriendRequest.mockRejectedValueOnce(new Error('x'));
    const view = await clickIn(MODES[0]);
    expect(view.getByRole('alert').textContent).toBe('Kunde inte skicka förfrågan.');

    rel.status = 'sent';
    await act(async () => {
      view.rerender(<FriendButton targetUid="them" />);
    });

    expect(view.queryByRole('alert')).toBeNull();
  });

  // Hiding the alert while the mode is away is not enough: the flag has to be
  // CLEARED, or it reappears unprompted the moment that mode comes back. That is
  // the stale-banner defect this ticket's sibling left on the send path.
  it('does not bring the alert back when the original mode returns', async () => {
    actions.sendFriendRequest.mockRejectedValueOnce(new Error('x'));
    const view = await clickIn(MODES[0]);
    expect(view.getByRole('alert')).toBeTruthy();

    rel.status = 'sent';
    await act(async () => {
      view.rerender(<FriendButton targetUid="them" />);
    });
    rel.status = 'none';
    await act(async () => {
      view.rerender(<FriendButton targetUid="them" />);
    });

    expect(view.queryByRole('alert')).toBeNull();
  });

  // A write that settles AFTER the relation left this mode and came back must not
  // blame the button showing now: that is a DIFFERENT request, which has not failed.
  // Re-deriving the expected action from `status` at settle time cannot catch it —
  // a round trip returns `status` to the same value — so the guard counts attempts
  // instead. Drive it with a promise this test controls; a settled mock cannot
  // reproduce the in-flight window at all.
  it('does not blame a later instance of the same mode for an abandoned click', async () => {
    let rejectCancel!: (e: unknown) => void;
    actions.cancelFriendRequest.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { rejectCancel = reject; }),
    );

    rel.status = 'sent';
    const view = render(<FriendButton targetUid="them" />);
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Förfrågan skickad' }));
    });
    expect(view.queryByRole('alert')).toBeNull();

    for (const next of ['friends', 'sent'] as const) {
      rel.status = next;
      await act(async () => {
        view.rerender(<FriendButton targetUid="them" />);
      });
    }

    await act(async () => {
      rejectCancel(new Error('x'));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });

    expect(view.queryByRole('alert')).toBeNull();
  });
});
