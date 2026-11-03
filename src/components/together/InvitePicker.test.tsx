// Bjud in till Tillsammans — the picker on /tillsammans/ny. Mocked member listener: this
// pins what is ticked and when, which is the panel's condition that a group start never
// invites anyone silently. It writes nothing; the send path has its own test.
//
// The listener is mocked under the real useGroupMemberNames and delivers its snapshot
// after a microtask, as Firestore's onSnapshot does not call back during subscribe. So
// right after a switch the hook has the old group's snapshot in state for a render.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { InvitePicker, type InvitePickerPerson } from './InvitePicker';
import { MAX_SESSION_INVITEES } from '@/lib/sessionInvites';

const members = vi.hoisted(() => ({ byGroup: {} as Record<string, Record<string, string>> }));
vi.mock('@/lib/firebase/groups', () => ({
  subscribeToGroupMembers: (groupId: string, cb: (m: { uid: string; displayName: string }[]) => void) => {
    let live = true;
    void Promise.resolve().then(() => {
      if (!live) return;
      cb(Object.entries(members.byGroup[groupId] ?? {}).map(([uid, displayName]) => ({ uid, displayName })));
    });
    return () => { live = false; };
  },
}));

const GROUPS = [{ id: 'g1', name: 'Hemma' }, { id: 'g2', name: 'Jobbet' }];

function Harness({ friends, initialGroup = null }: { friends: InvitePickerPerson[]; initialGroup?: string | null }) {
  const [groupId, setGroupId] = useState<string | null>(initialGroup);
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      <InvitePicker
        myUid="me" friends={friends} groups={GROUPS}
        groupId={groupId} onGroupChange={setGroupId}
        selected={selected} onSelectedChange={setSelected}
      />
      <output data-testid="selected">{selected.join(',')}</output>
    </>
  );
}

const selectedNow = () => screen.getByTestId('selected').textContent;
const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

describe('InvitePicker', () => {
  beforeEach(() => {
    members.byGroup = {
      g1: { me: 'Jag', anna: 'Anna', bo: 'Bo' },
      g2: { me: 'Jag', cia: 'Cia' },
    };
  });

  it('lists friends unticked, and nothing is selected before a choice', () => {
    render(<Harness friends={[{ uid: 'dan', name: 'Dan' }]} />);
    expect(box('Dan').checked).toBe(false);
    expect(selectedNow()).toBe('');
  });

  it('ticks a chosen group\'s members, never the host, and lets the host untick one', async () => {
    render(<Harness friends={[]} />);
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Hemma' })); });
    expect(selectedNow()).toBe('anna,bo');
    expect(screen.queryByRole('checkbox', { name: 'Jag' })).toBeNull();
    await act(async () => { fireEvent.click(box('Bo')); });
    expect(selectedNow()).toBe('anna');
    expect(box('Bo').checked).toBe(false);
  });

  it('ticks the members of a group passed in from a group page, still untickable', async () => {
    await act(async () => { render(<Harness friends={[]} initialGroup="g1" />); });
    expect(selectedNow()).toBe('anna,bo');
    await act(async () => { fireEvent.click(box('Anna')); });
    expect(selectedNow()).toBe('bo');
  });

  it('switching group unticks the old group\'s members and keeps ticked friends', async () => {
    render(<Harness friends={[{ uid: 'dan', name: 'Dan' }]} />);
    await act(async () => { fireEvent.click(box('Dan')); });
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Hemma' })); });
    expect(selectedNow()).toBe('dan,anna,bo');
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Jobbet' })); });
    expect(selectedNow()).toBe('dan,cia');
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Ingen grupp' })); });
    expect(selectedNow()).toBe('dan');
  });

  it('switching straight from one group to another ticks the new group\'s members only', async () => {
    render(<Harness friends={[]} />);
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Hemma' })); });
    expect(selectedNow()).toBe('anna,bo');
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Jobbet' })); });
    expect(selectedNow()).toBe('cia');
    expect(box('Cia').checked).toBe(true);
    expect(screen.queryByRole('checkbox', { name: 'Anna' })).toBeNull();
  });

  it('a friend who is also a member is listed once, under the group', async () => {
    render(<Harness friends={[{ uid: 'anna', name: 'Anna' }]} />);
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Hemma' })); });
    expect(screen.getAllByRole('checkbox', { name: 'Anna' })).toHaveLength(1);
  });

  it('stops at the cap: unticked boxes are disabled once it is reached', async () => {
    const many = Array.from({ length: MAX_SESSION_INVITEES + 1 }, (_, i) => ({ uid: `f${i}`, name: `Vän ${i}` }));
    render(<Harness friends={many} />);
    for (let i = 0; i < MAX_SESSION_INVITEES; i++) {
      await act(async () => { fireEvent.click(box(`Vän ${i}`)); });
    }
    expect(selectedNow()?.split(',')).toHaveLength(MAX_SESSION_INVITEES);
    expect(box(`Vän ${MAX_SESSION_INVITEES}`).disabled).toBe(true);
    expect(box('Vän 0').disabled).toBe(false);
  });

  it('says so when there is nobody to invite', () => {
    render(
      <InvitePicker myUid="me" friends={[]} groups={[]} groupId={null}
        onGroupChange={() => {}} selected={[]} onSelectedChange={() => {}} />,
    );
    expect(screen.getByText(/inga vänner eller grupper/)).toBeTruthy();
  });
});
